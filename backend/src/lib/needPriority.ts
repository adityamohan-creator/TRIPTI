import {
  type PriorityBreakdown,
  type PriorityInput,
  type Severity,
  priorityBreakdown,
} from '../engine/priority.js'

/**
 * Needs whose delay costs lives rather than comfort. Kept in one place so the
 * match preview and the incident screen cannot drift apart on what counts as
 * life-critical.
 */
export const LIFE_CRITICAL_KINDS = new Set(['rescue', 'medical', 'evacuation'])

export interface IncidentContext {
  severity: Severity
  people_affected: number | null
  created_at: string
  vulnerable_groups?: unknown
}

export interface NeedContext {
  kind: string
  status?: string | null
  quantity?: number | null
  /** Units already committed by live matches, if known. */
  fulfilled?: number | null
}

function hasVulnerableGroups(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

/**
 * Translates database rows into the engine's input. The engine itself stays
 * pure and knows nothing about Supabase; this is the seam between them.
 */
export function toPriorityInput(
  incident: IncidentContext,
  need: NeedContext,
  now: number = Date.now(),
): PriorityInput {
  const required = need.quantity ?? null
  const fulfilled = need.fulfilled ?? 0

  // Unmetered needs cannot report a fraction, so they count as fully short —
  // which is the safe direction: it never under-prioritises something unserved.
  const shortageRatio =
    required && required > 0 ? Math.min(1, Math.max(0, 1 - fulfilled / required)) : 1

  return {
    severity: incident.severity,
    peopleAffected: incident.people_affected,
    ageMinutes: (now - new Date(incident.created_at).getTime()) / 60_000,
    lifeCritical: LIFE_CRITICAL_KINDS.has(need.kind),
    unmet: need.status !== 'met' && need.status !== 'cancelled',
    shortageRatio,
    vulnerable: hasVulnerableGroups(incident.vulnerable_groups),
  }
}

export function needPriority(
  incident: IncidentContext,
  need: NeedContext,
  now?: number,
): PriorityBreakdown {
  return priorityBreakdown(toPriorityInput(incident, need, now))
}
