export type Severity = 'low' | 'medium' | 'high' | 'critical'

export interface PriorityInput {
  severity: Severity
  peopleAffected: number | null
  /** Minutes since the incident was reported. */
  ageMinutes: number
  /** Set when the need is life-threatening without intervention (rescue, medical). */
  lifeCritical: boolean
  /** True when no resource has been committed yet. */
  unmet: boolean
}

const SEVERITY_WEIGHT: Record<Severity, number> = {
  low: 10,
  medium: 30,
  high: 60,
  critical: 100,
}

/**
 * Deterministic priority score, 0-200ish. Pure function of stated facts — same
 * input always gives the same score, and every term is auditable after the fact.
 * No model output feeds into this.
 */
export function priorityScore(input: PriorityInput): number {
  let score = SEVERITY_WEIGHT[input.severity]

  // Scale sublinearly: 500 people is worse than 50, but not ten times worse.
  if (input.peopleAffected && input.peopleAffected > 0) {
    score += Math.min(40, 8 * Math.log10(input.peopleAffected + 1) * 2)
  }

  // Waiting incidents rise so nothing starves at the bottom of the queue.
  score += Math.min(30, (input.ageMinutes / 60) * 5)

  if (input.lifeCritical) score += 50
  if (input.unmet) score += 10

  return Math.round(score * 100) / 100
}
