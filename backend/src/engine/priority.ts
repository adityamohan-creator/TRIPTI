export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type PriorityLevel = 'routine' | 'elevated' | 'high' | 'critical'

export interface PriorityInput {
  severity: Severity
  peopleAffected: number | null
  /** Minutes since the incident was reported. */
  ageMinutes: number
  /** Set when the need is life-threatening without intervention (rescue, medical). */
  lifeCritical: boolean
  /** True when no resource has been committed yet. */
  unmet: boolean
  /**
   * Fraction of the need still unfilled, 0–1. Defaults to fully unfilled, which
   * is the honest assumption before any match exists.
   */
  shortageRatio?: number
  /** Children, elderly, disabled, pregnant or injured people are involved. */
  vulnerable?: boolean
}

/**
 * Weights from the PRD, §11. They sum to 1 and the score is a percentage, so a
 * coordinator can read "68" as "68 out of a possible 100" rather than as a
 * number on an invented scale.
 *
 * Configurable on purpose: the right balance differs between an urban flood and
 * a rural earthquake, and that is an operational decision, not a code change.
 */
export interface PriorityWeights {
  severity: number
  peopleAffected: number
  urgency: number
  shortage: number
  vulnerability: number
}

export const DEFAULT_WEIGHTS: PriorityWeights = {
  severity: 0.3,
  peopleAffected: 0.25,
  urgency: 0.2,
  shortage: 0.15,
  vulnerability: 0.1,
}

export interface PriorityTerm {
  key: keyof PriorityWeights
  label: string
  /** 0–1, before weighting. */
  normalised: number
  weight: number
  /** normalised × weight × 100 — what this term contributed to the score. */
  points: number
  /** Plain sentence a coordinator can read without knowing the formula. */
  detail: string
}

export interface PriorityBreakdown {
  score: number
  level: PriorityLevel
  terms: PriorityTerm[]
}

const SEVERITY_NORMAL: Record<Severity, number> = {
  low: 0.25,
  medium: 0.5,
  high: 0.75,
  critical: 1,
}

/** Ten thousand people is the top of the scale; beyond that, degree stops mattering. */
const PEOPLE_CEILING = 10_000

/** Four hours of waiting reaches the top of the urgency-from-age ramp. */
const AGE_CEILING_MINUTES = 240

const round2 = (n: number) => Math.round(n * 100) / 100
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/**
 * Scale sublinearly: 500 people is worse than 50, but not ten times worse, and
 * a linear term would let one large incident bury every small one permanently.
 */
function normalisePeople(peopleAffected: number | null): number {
  if (!peopleAffected || peopleAffected <= 0) return 0
  return clamp01(Math.log10(peopleAffected + 1) / Math.log10(PEOPLE_CEILING + 1))
}

/**
 * Urgency combines what the need is with how long it has waited. Life-critical
 * kinds start at the top; everything else rises as it ages so nothing starves at
 * the bottom of the queue.
 */
function normaliseUrgency(input: PriorityInput): number {
  if (input.lifeCritical) return 1
  const fromAge = clamp01(input.ageMinutes / AGE_CEILING_MINUTES)
  // An untouched need is more urgent than a partly served one, all else equal.
  return clamp01(fromAge * 0.85 + (input.unmet ? 0.15 : 0))
}

export function priorityLevel(score: number): PriorityLevel {
  if (score >= 75) return 'critical'
  if (score >= 55) return 'high'
  if (score >= 35) return 'elevated'
  return 'routine'
}

/**
 * The full, explainable score. Pure function of stated facts — same input always
 * gives the same result, every term is inspectable, and no model output feeds
 * into it. A coordinator overriding this needs to see why it said what it said.
 */
export function priorityBreakdown(
  input: PriorityInput,
  weights: PriorityWeights = DEFAULT_WEIGHTS,
): PriorityBreakdown {
  const shortage = clamp01(input.shortageRatio ?? 1)
  const people = normalisePeople(input.peopleAffected)
  const urgency = normaliseUrgency(input)
  const vulnerability = input.vulnerable ? 1 : 0
  const severity = SEVERITY_NORMAL[input.severity]

  const terms: PriorityTerm[] = [
    {
      key: 'severity',
      label: 'Severity',
      normalised: severity,
      weight: weights.severity,
      points: round2(severity * weights.severity * 100),
      detail: `Reported as ${input.severity}.`,
    },
    {
      key: 'peopleAffected',
      label: 'People affected',
      normalised: round2(people),
      weight: weights.peopleAffected,
      points: round2(people * weights.peopleAffected * 100),
      detail:
        input.peopleAffected && input.peopleAffected > 0
          ? `${input.peopleAffected.toLocaleString()} people, scaled logarithmically.`
          : 'No figure reported, so this contributes nothing.',
    },
    {
      key: 'urgency',
      label: 'Urgency',
      normalised: round2(urgency),
      weight: weights.urgency,
      points: round2(urgency * weights.urgency * 100),
      detail: input.lifeCritical
        ? 'Life-threatening without intervention.'
        : `Waiting ${Math.round(input.ageMinutes)} minutes.`,
    },
    {
      key: 'shortage',
      label: 'Resource shortage',
      normalised: round2(shortage),
      weight: weights.shortage,
      points: round2(shortage * weights.shortage * 100),
      detail:
        shortage >= 1
          ? 'Nothing has been committed to this yet.'
          : `${Math.round((1 - shortage) * 100)}% of the requirement is covered.`,
    },
    {
      key: 'vulnerability',
      label: 'Vulnerability',
      normalised: vulnerability,
      weight: weights.vulnerability,
      points: round2(vulnerability * weights.vulnerability * 100),
      detail: input.vulnerable
        ? 'Children, elderly, injured or otherwise less able to move.'
        : 'No vulnerable group was reported.',
    },
  ]

  const score = round2(terms.reduce((sum, term) => sum + term.points, 0))
  return { score, level: priorityLevel(score), terms }
}

/** The score alone, for callers that only need to rank. */
export function priorityScore(
  input: PriorityInput,
  weights: PriorityWeights = DEFAULT_WEIGHTS,
): number {
  return priorityBreakdown(input, weights).score
}
