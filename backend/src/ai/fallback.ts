import type { ExtractedIncident } from './types.js'

/**
 * Deterministic extraction for when the model is unreachable.
 *
 * A disaster-response intake form must not stop accepting reports because an
 * API is down, so this keeps the door open. What it deliberately does *not* do
 * is pretend to be the model: it reports `confidence: 0`, names every field it
 * could not determine in `unclear`, and never guesses a number.
 *
 * The only inference here is literal keyword presence — "water" in the text
 * means the word water appears, not that 600 litres are required. Severity is
 * only raised by explicit words, never by tone. Everything lands on a
 * coordinator's queue as `open`, which is where an unverified report belongs
 * anyway.
 */

const KIND_KEYWORDS: Record<string, string[]> = {
  water: ['water', 'drinking water', 'pani', 'पानी', 'thirst'],
  food: ['food', 'meal', 'meals', 'khana', 'खाना', 'ration', 'hungry', 'hunger'],
  shelter: ['shelter', 'tent', 'housing', 'homeless', 'displaced', 'stranded'],
  medical: ['medical', 'medicine', 'doctor', 'injured', 'injury', 'hospital', 'ambulance'],
  rescue: ['rescue', 'trapped', 'stuck', 'drowning', 'buried'],
  evacuation: ['evacuate', 'evacuation', 'move out', 'relocate'],
  clothing: ['clothes', 'clothing', 'blanket', 'blankets', 'warm'],
  sanitation: ['sanitation', 'toilet', 'hygiene', 'sewage'],
  power: ['power', 'electricity', 'generator', 'blackout'],
}

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  flood: ['flood', 'flooding', 'water logging', 'waterlogging', 'inundated', 'baadh'],
  fire: ['fire', 'burning', 'blaze', 'smoke'],
  earthquake: ['earthquake', 'quake', 'tremor', 'aftershock'],
  cyclone: ['cyclone', 'storm', 'hurricane', 'typhoon'],
  landslide: ['landslide', 'mudslide', 'rockfall'],
  medical: ['outbreak', 'epidemic', 'disease', 'casualties'],
  displacement: ['displaced', 'refugee', 'stranded', 'evacuated'],
  infrastructure: ['bridge', 'road collapsed', 'building collapsed', 'power line'],
}

/** Only explicit severity words count. Panic in the prose is not evidence. */
const SEVERITY_KEYWORDS: [ExtractedIncident['severity'], string[]][] = [
  ['critical', ['critical', 'life threatening', 'life-threatening', 'dying', 'fatal']],
  ['high', ['urgent', 'emergency', 'severe', 'immediately', 'serious']],
]

function matches(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle))
}

export function fallbackExtract(reportText: string): ExtractedIncident {
  const text = reportText.toLowerCase()

  const category =
    (Object.keys(CATEGORY_KEYWORDS).find((key) =>
      matches(text, CATEGORY_KEYWORDS[key]!),
    ) as ExtractedIncident['category'] | undefined) ?? 'other'

  const severity =
    SEVERITY_KEYWORDS.find(([, words]) => matches(text, words))?.[0] ?? 'medium'

  const needs = Object.keys(KIND_KEYWORDS)
    .filter((kind) => matches(text, KIND_KEYWORDS[kind]!))
    .map((kind) => ({
      kind: kind as ExtractedIncident['needs'][number]['kind'],
      // No quantity. The words appear; the amount does not follow from that.
      quantity: null,
      unit: null,
      note: 'Detected by keyword while AI extraction was unavailable. Confirm.',
    }))

  const unclear = [
    'AI extraction was unavailable, so this report has not been read — only keyword-scanned.',
    'Confirm the category, severity and location before acting on this.',
    'No number of people affected was extracted; read the report text.',
  ]
  if (needs.length === 0) {
    unclear.push('No needs were detected. The report may still describe some.')
  }

  return {
    // The raw report is the summary. Anything shorter would be a claim about
    // content that nothing actually read.
    summary: reportText.trim().slice(0, 280),
    category,
    severity,
    location_text: null,
    people_affected: null,
    needs,
    vulnerable_groups: [],
    source_language: 'und',
    confidence: 0,
    unclear,
  }
}
