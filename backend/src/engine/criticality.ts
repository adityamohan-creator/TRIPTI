import { LIFE_THREATENING, type InformationType } from '../ai/informationTypes.js'

/**
 * How urgent a fused cluster of reports is, 0-100.
 *
 * ## Not `priority.ts`, and not a replacement for it
 *
 * TRIPTI already scores priority, and it answers a different question. That
 * engine ranks a *need against the resource pool* — it reads `unmet`,
 * `shortageRatio` and whether anything has been committed yet. Those inputs do
 * not exist for an incoming report: nobody has planned against it, there is no
 * shortage ratio, and there may be no matching resource at all.
 *
 * This scores an *incoming report cluster* on what the reports themselves say,
 * before any of that is known. The two run at different moments on different
 * evidence, and collapsing them would break resource coordination while
 * producing a worse answer here. Neither calls the other.
 *
 * ## Pure, and explainable
 *
 * No I/O, no clock, no database. Every score comes with the terms that
 * produced it, because a coordinator overruling a 92 is entitled to see what
 * the 92 was made of.
 */

export type CriticalityLevel = 'critical' | 'high' | 'medium' | 'low'

export interface CriticalityInput {
  /** Every report in the cluster, as written. */
  texts: string[]
  /** What the cluster was classified as. */
  informationType: InformationType
  /** How many distinct reports corroborate this. */
  reportCount: number
  /** Stated headcount, where any report gives one. Null when unknown. */
  peopleAffected: number | null
  /** Classifier confidence, 0-1. */
  classificationConfidence: number
}

export interface CriticalityFactor {
  key: string
  label: string
  /** Points this contributed. Always non-negative; the score is additive. */
  points: number
  /** What triggered it — a matched phrase, a count, a category. */
  detail: string
}

export interface Criticality {
  /** 0-100. */
  score: number
  level: CriticalityLevel
  /** One or two sentences a coordinator can read at a glance. */
  reason: string
  factors: CriticalityFactor[]
}

/*
 * Phrases that indicate immediate danger to life, with weights.
 *
 * Separate from the classifier's term list on purpose: that list answers "what
 * is this about", this one answers "how bad is it right now". "Hospital"
 * classifies as medical; "hospital collapsed" is an emergency. The overlap is
 * real but the questions are different, and merging the lists would make both
 * worse.
 */
const DANGER_TERMS: [string, number, string][] = [
  ['trapped', 14, 'people trapped'],
  ['stranded', 12, 'people stranded'],
  ['drowning', 16, 'drowning reported'],
  ['swept away', 14, 'people swept away'],
  ['casualt', 16, 'casualties reported'],
  ['dead', 16, 'deaths reported'],
  ['died', 16, 'deaths reported'],
  ['killed', 16, 'deaths reported'],
  ['bodies', 16, 'bodies reported'],
  ['injur', 12, 'injuries reported'],
  ['bleeding', 12, 'bleeding reported'],
  ['unconscious', 14, 'unconscious casualties'],
  ['collapse', 11, 'structural collapse'],
  ['buried', 14, 'people buried'],
  ['children', 8, 'children involved'],
  ['elderly', 7, 'elderly residents involved'],
  ['disabled', 7, 'disabled residents involved'],
  ['pregnant', 7, 'pregnant women involved'],
  ['hospital', 6, 'hospital affected'],
  ['no oxygen', 14, 'oxygen unavailable'],
  ['urgent', 6, 'described as urgent'],
  ['immediately', 6, 'immediate action requested'],
  ['sos', 10, 'distress signal'],
  ['worsening', 6, 'situation worsening'],
  ['rising', 5, 'conditions escalating'],
  ['spreading', 6, 'spreading'],
]

function normalise(text: string): string {
  return ` ${text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ')} `
}

/** Headcount → points, flattening so ten thousand is not ten times four hundred. */
function headcountPoints(people: number): number {
  if (people <= 0) return 0
  // log10 scaled: 10 -> ~5, 100 -> ~10, 1,000 -> ~15, 10,000 -> ~20.
  return Math.min(20, Math.round(Math.log10(people) * 5))
}

/**
 * Corroboration, with diminishing returns.
 *
 * Two independent reports of the same thing is meaningfully stronger evidence
 * than one. The twentieth is not meaningfully stronger than the nineteenth,
 * and letting it be would mean a busy hashtag outranks a real emergency.
 */
function corroborationPoints(reportCount: number): number {
  if (reportCount <= 1) return 0
  return Math.min(12, Math.round(Math.log2(reportCount) * 6))
}

export function criticalityLevel(score: number): CriticalityLevel {
  if (score >= 85) return 'critical'
  if (score >= 65) return 'high'
  if (score >= 40) return 'medium'
  return 'low'
}

export function scoreCriticality(input: CriticalityInput): Criticality {
  const factors: CriticalityFactor[] = []

  /*
   * A floor from the category itself, before any wording is read. A rescue
   * request with no dramatic language is still a rescue request.
   */
  const categoryBase = LIFE_THREATENING.has(input.informationType) ? 34 : 18
  factors.push({
    key: 'category',
    label: 'Information type',
    points: categoryBase,
    detail: LIFE_THREATENING.has(input.informationType)
      ? `${input.informationType.replace(/_/g, ' ')} — life-threatening category`
      : `${input.informationType.replace(/_/g, ' ')}`,
  })

  // Danger language, counted once per distinct phrase across the whole cluster.
  const haystack = input.texts.map(normalise).join(' ')
  const seen = new Set<string>()
  let dangerPoints = 0
  const dangerDetails: string[] = []

  for (const [term, weight, detail] of DANGER_TERMS) {
    if (haystack.includes(term) && !seen.has(detail)) {
      seen.add(detail)
      dangerPoints += weight
      dangerDetails.push(detail)
    }
  }

  /*
   * Capped. Long clusters accumulate phrases simply by being long, and without
   * a ceiling a chatty thread about a minor incident outscores a terse report
   * of a fatal one.
   */
  dangerPoints = Math.min(38, dangerPoints)
  if (dangerPoints > 0) {
    factors.push({
      key: 'danger',
      label: 'Immediate danger',
      points: dangerPoints,
      detail: dangerDetails.slice(0, 4).join(', '),
    })
  }

  if (input.peopleAffected != null && input.peopleAffected > 0) {
    const points = headcountPoints(input.peopleAffected)
    factors.push({
      key: 'scale',
      label: 'People affected',
      points,
      detail: `${input.peopleAffected.toLocaleString()} reported affected`,
    })
  }

  const corroboration = corroborationPoints(input.reportCount)
  if (corroboration > 0) {
    factors.push({
      key: 'corroboration',
      label: 'Corroboration',
      points: corroboration,
      detail: `${input.reportCount} separate reports describe this`,
    })
  }

  /*
   * Low classifier confidence subtracts nothing — it simply fails to add.
   *
   * Deliberate: a report the classifier found hard to read is not therefore
   * less urgent, and docking it would push exactly the ambiguous,
   * badly-written, panicked reports down the queue.
   */
  const confidencePoints = Math.round(input.classificationConfidence * 6)
  if (confidencePoints > 0) {
    factors.push({
      key: 'confidence',
      label: 'Classification confidence',
      points: confidencePoints,
      detail: `${Math.round(input.classificationConfidence * 100)}% confident in the category`,
    })
  }

  const raw = factors.reduce((sum, f) => sum + f.points, 0)
  const score = Math.max(0, Math.min(100, raw))
  const level = criticalityLevel(score)

  return { score, level, reason: buildReason(level, input, dangerDetails), factors }
}

/**
 * The sentence a coordinator reads.
 *
 * Assembled from what actually fired rather than from a template per level, so
 * it cannot describe something the score did not consider.
 */
function buildReason(
  level: CriticalityLevel,
  input: CriticalityInput,
  dangerDetails: string[],
): string {
  const parts: string[] = []

  parts.push(
    input.reportCount > 1
      ? `${input.reportCount} corroborating reports`
      : 'A single report',
  )

  parts.push(`classified as ${input.informationType.replace(/_/g, ' ')}`)

  if (dangerDetails.length > 0) {
    parts.push(`with ${dangerDetails.slice(0, 3).join(', ')}`)
  }

  if (input.peopleAffected != null && input.peopleAffected > 0) {
    parts.push(`affecting around ${input.peopleAffected.toLocaleString()} people`)
  }

  const closing: Record<CriticalityLevel, string> = {
    critical: 'Needs a response now.',
    high: 'Should be actioned ahead of routine work.',
    medium: 'Worth planning for in this cycle.',
    low: 'No immediate action indicated.',
  }

  return `${parts.join(', ')}. ${closing[level]}`
}
