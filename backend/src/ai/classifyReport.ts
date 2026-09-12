import {
  type InformationType,
  NEED_TYPES,
  isInformationType,
} from './informationTypes.js'

/**
 * Deciding what a report is about.
 *
 * Deterministic keyword scoring, not a model. Three reasons, in order of how
 * much they mattered:
 *
 *  1. It runs with no API key, which is the state this deployment is actually
 *     in. A classifier that returns nothing without a key is not a feature.
 *  2. It is explainable — every classification carries the terms that produced
 *     it, so a coordinator disputing a category can see exactly why.
 *  3. It cannot hallucinate a category that does not exist.
 *
 * A model-backed provider can be added behind `ClassificationProvider` and
 * would likely beat this on nuance. It would not beat it on being auditable,
 * so this stays as the floor rather than as a stopgap.
 */

export interface Classification {
  type: InformationType
  /** 0-1. Zero means nothing matched and `other` was the fallback. */
  confidence: number
  /** The terms that decided it. Shown in the UI; never invented. */
  matchedTerms: string[]
  /** Runners-up, for a coordinator deciding the classifier got it wrong. */
  alternatives: { type: InformationType; score: number }[]
}

export interface ClassificationProvider {
  readonly name: string
  classify(text: string): Promise<Classification> | Classification
}

/*
 * Terms per category, with weights.
 *
 * Weighted because a term like "trapped" is close to decisive for a rescue
 * request, while "people" appears in almost every report. A flat keyword list
 * lets common words outvote the rare ones that actually carry the meaning.
 *
 * Multi-word phrases are matched as substrings of the normalised text, so
 * "drinking water" scores water_need without "water" alone dragging every
 * flood report into it.
 */
const TERMS: Record<InformationType, [string, number][]> = {
  rescue_request: [
    ['trapped', 3], ['stranded', 3], ['stuck on roof', 3], ['rescue', 3],
    ['save us', 3], ['send help', 2.5], ['cannot get out', 2.5], ['boat', 1.5],
    ['swept away', 2.5], ['missing person', 2],
  ],
  casualty_or_injury: [
    ['casualt', 3], ['dead', 3], ['death', 3], ['died', 3], ['killed', 3],
    ['injur', 3], ['wounded', 3], ['bleeding', 2.5], ['fatalit', 3],
    ['body', 2], ['bodies', 2.5],
  ],
  medical_need: [
    ['medical', 3], ['medicine', 3], ['doctor', 2.5], ['hospital', 2],
    ['ambulance', 3], ['first aid', 3], ['insulin', 2.5], ['oxygen', 3],
    ['dialysis', 2.5], ['pregnant', 2],
  ],
  evacuation: [
    ['evacuat', 3], ['move people', 2], ['relocat', 2.5], ['shift resident', 2.5],
    ['leave the area', 2.5], ['ordered out', 2],
  ],
  flooding: [
    ['flood', 3], ['water level', 2.5], ['waterlog', 3], ['submerg', 3],
    ['inundat', 3], ['water entered', 3], ['water rising', 3], ['overflow', 2.5],
    ['knee deep', 2.5], ['dam', 1.5],
  ],
  fire: [
    ['fire', 3], ['burning', 3], ['smoke', 2.5], ['blaze', 3], ['flames', 3],
    ['arson', 2.5], ['gas leak', 2],
  ],
  infrastructure_damage: [
    ['bridge', 2.5], ['collapse', 3], ['road block', 2.5], ['road clos', 2.5],
    ['power cut', 3], ['no electricity', 3], ['network down', 2.5],
    ['building damag', 3], ['roof', 2], ['cracked', 2], ['landslide', 2.5],
    ['tower down', 2.5],
  ],
  shelter_need: [
    ['shelter', 3], ['homeless', 3], ['nowhere to stay', 3], ['tent', 2.5],
    ['blanket', 2.5], ['relief camp', 2], ['warm clothes', 2.5], ['sleeping', 1.5],
  ],
  food_need: [
    ['food', 3], ['hungry', 3], ['meal', 3], ['ration', 3], ['nothing to eat', 3],
    ['milk', 2], ['baby food', 3],
  ],
  water_need: [
    ['drinking water', 3], ['no water', 3], ['water shortage', 3],
    ['clean water', 3], ['thirsty', 2.5], ['water supply', 2], ['tanker', 2],
  ],
  resource_availability: [
    ['we have', 2.5], ['available', 2.5], ['can provide', 3], ['offering', 3],
    ['donat', 3], ['volunteer', 2], ['surplus', 3], ['ready to help', 3],
    ['distributing', 2.5],
  ],
  other: [],
}

/** Lowercase, collapse punctuation to spaces, so phrases match reliably. */
function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ')} `
}

export interface ScoredType {
  type: InformationType
  score: number
  terms: string[]
}

/** Every category's score, strongest first. Exposed for testing and the UI. */
export function scoreTypes(text: string): ScoredType[] {
  const haystack = normalise(text)
  const scored: ScoredType[] = []

  for (const [type, terms] of Object.entries(TERMS) as [InformationType, [string, number][]][]) {
    let score = 0
    const matched: string[] = []

    for (const [term, weight] of terms) {
      if (haystack.includes(term)) {
        score += weight
        matched.push(term)
      }
    }

    if (score > 0) scored.push({ type, score, terms: matched })
  }

  // Ties broken by category name so the result never depends on object order.
  return scored.sort((a, b) => b.score - a.score || a.type.localeCompare(b.type))
}

/*
 * Above this raw score, a classification is treated as confident. Roughly one
 * decisive term or two supporting ones — below that the report is usually
 * ambiguous enough that a coordinator should look.
 */
const CONFIDENT_AT = 3

export const keywordClassifier: ClassificationProvider = {
  name: 'keyword-v1',

  classify(text): Classification {
    const scored = scoreTypes(text)

    if (scored.length === 0) {
      /*
       * `other` with zero confidence, never a guess at the most common
       * category. A classifier that quietly picks something plausible when it
       * has nothing is indistinguishable from one that is working.
       */
      return { type: 'other', confidence: 0, matchedTerms: [], alternatives: [] }
    }

    const best = scored[0]!

    /*
     * A need beats a bare observation at equal score.
     *
     * "No drinking water at the camp" scores water_need and flooding alike in
     * a flood report, and the need is the actionable half — it is what a
     * coordinator dispatches against.
     */
    const tie = scored.filter((s) => s.score === best.score)
    const chosen = tie.find((s) => NEED_TYPES.has(s.type)) ?? best

    return {
      type: chosen.type,
      confidence: Math.min(1, Math.round((chosen.score / (CONFIDENT_AT * 2)) * 100) / 100),
      matchedTerms: chosen.terms,
      alternatives: scored
        .filter((s) => s.type !== chosen.type)
        .slice(0, 3)
        .map((s) => ({ type: s.type, score: Math.round(s.score * 100) / 100 })),
    }
  },
}

/**
 * Classifies a fused cluster from the text of all its reports.
 *
 * Scores are summed across members rather than voted on. Three reports each
 * weakly suggesting rescue is stronger evidence than one report mentioning it
 * in passing, and a vote over per-report winners throws that away.
 */
export function classifyCluster(
  texts: string[],
  provider: ClassificationProvider = keywordClassifier,
): Classification {
  if (texts.length === 0) {
    return { type: 'other', confidence: 0, matchedTerms: [], alternatives: [] }
  }
  if (texts.length === 1) return provider.classify(texts[0]!) as Classification

  const totals = new Map<InformationType, { score: number; terms: Set<string> }>()

  for (const text of texts) {
    for (const scored of scoreTypes(text)) {
      const entry = totals.get(scored.type) ?? { score: 0, terms: new Set<string>() }
      entry.score += scored.score
      for (const t of scored.terms) entry.terms.add(t)
      totals.set(scored.type, entry)
    }
  }

  if (totals.size === 0) {
    return { type: 'other', confidence: 0, matchedTerms: [], alternatives: [] }
  }

  const ranked = [...totals.entries()]
    .map(([type, v]) => ({ type, score: v.score, terms: [...v.terms].sort() }))
    .sort((a, b) => b.score - a.score || a.type.localeCompare(b.type))

  const best = ranked[0]!
  const tie = ranked.filter((s) => s.score === best.score)
  const chosen = tie.find((s) => NEED_TYPES.has(s.type)) ?? best

  return {
    type: chosen.type,
    // Normalised by cluster size, so a big cluster is not automatically certain.
    confidence: Math.min(
      1,
      Math.round((chosen.score / (CONFIDENT_AT * 2 * texts.length)) * 100) / 100,
    ),
    matchedTerms: chosen.terms,
    alternatives: ranked
      .filter((s) => s.type !== chosen.type)
      .slice(0, 3)
      .map((s) => ({ type: s.type, score: Math.round(s.score * 100) / 100 })),
  }
}

export { isInformationType }
