import {
  DEFAULT_MATCH_WEIGHTS,
  type Match,
  type MatchPlan,
  type Need,
  type Resource,
  type Vehicle,
  matchNeeds,
} from '../engine/match.js'
import { LIFE_CRITICAL_KINDS, toPriorityInput } from '../lib/needPriority.js'
import { admin } from '../supabase.js'

/**
 * Loads the pool and runs the engine over it.
 *
 * This is the seam between the database and the pure matcher: everything below
 * shapes rows into engine inputs, and nothing above it knows what Supabase
 * looks like. The engine itself stays free of I/O so its behaviour is entirely
 * determined by its arguments.
 */

interface IncidentJoin {
  lat: number | null
  lon: number | null
  severity: 'low' | 'medium' | 'high' | 'critical'
  people_affected: number | null
  created_at: string
  vulnerable_groups: unknown
}

/**
 * Supabase types an embedded to-one relation as an array even though it comes
 * back as a single object. Without generated database types there is nothing
 * better to narrow against, so normalize both shapes here.
 */
function oneRelation(value: unknown): IncidentJoin | null {
  const row = Array.isArray(value) ? value[0] : value
  return (row as IncidentJoin | undefined) ?? null
}

export interface PoolSnapshot {
  needs: Need[]
  resources: Resource[]
  vehicles: Vehicle[]
  /**
   * Needs excluded because nobody has located their incident. Never silently
   * dropped — a coordinator has to know they are handling these by hand.
   */
  needsMissingCoordinates: string[]
  resourcesMissingCoordinates: string[]
}

export async function loadPool(now: number = Date.now()): Promise<PoolSnapshot> {
  const [needsResult, resourcesResult, vehiclesResult] = await Promise.all([
    admin
      .from('needs')
      .select(
        'id, incident_id, kind, quantity, status, incidents(lat, lon, severity, people_affected, created_at, vulnerable_groups)',
      )
      .in('status', ['unmet', 'partial']),
    admin
      .from('resources')
      .select('id, kind, quantity, reserved_quantity, lat, lon, expiry_time, perishable')
      .eq('status', 'available'),
    admin
      .from('vehicles')
      .select('id, capacity_units, refrigerated, availability'),
  ])

  if (needsResult.error) throw needsResult.error
  if (resourcesResult.error) throw resourcesResult.error
  if (vehiclesResult.error) throw vehiclesResult.error

  const needs: Need[] = []
  const needsMissingCoordinates: string[] = []

  for (const row of needsResult.data ?? []) {
    const incident = oneRelation(row.incidents)

    // Distance is a term in every match score, so a need without coordinates
    // cannot be ranked at all. Excluded and reported, never guessed.
    if (incident?.lat == null || incident.lon == null) {
      needsMissingCoordinates.push(row.id)
      continue
    }

    needs.push({
      ...toPriorityInput(incident, { kind: row.kind, status: row.status, quantity: row.quantity }, now),
      id: row.id,
      incidentId: row.incident_id,
      kind: row.kind,
      quantity: row.quantity,
      at: { lat: incident.lat, lon: incident.lon },
      lifeCritical: LIFE_CRITICAL_KINDS.has(row.kind),
    })
  }

  const resources: Resource[] = []
  const resourcesMissingCoordinates: string[] = []

  for (const row of resourcesResult.data ?? []) {
    if (row.lat == null || row.lon == null) {
      resourcesMissingCoordinates.push(row.id)
      continue
    }
    resources.push({
      id: row.id,
      kind: row.kind,
      quantity: row.quantity,
      reservedQuantity: Number(row.reserved_quantity ?? 0),
      at: { lat: row.lat, lon: row.lon },
      expiryTime: row.expiry_time,
      perishable: Boolean(row.perishable),
    })
  }

  const vehicles: Vehicle[] = (vehiclesResult.data ?? []).map((row) => ({
    id: row.id,
    capacityUnits: row.capacity_units,
    refrigerated: Boolean(row.refrigerated),
    available: row.availability === 'available',
  }))

  return { needs, resources, vehicles, needsMissingCoordinates, resourcesMissingCoordinates }
}

export interface PlanPreview extends MatchPlan {
  needsMissingCoordinates: string[]
  resourcesMissingCoordinates: string[]
  /** Fraction of considered need quantity a plan actually covers, 0-1. */
  coverage: number
  weights: typeof DEFAULT_MATCH_WEIGHTS
}

/**
 * How much of what was asked for this plan actually delivers.
 *
 * Two different questions, depending on the pool:
 *
 * By quantity, where quantities exist — 300 of 600 litres is 50%.
 *
 * By need count, where they do not. Unmetered needs are common: the keyword
 * fallback never invents an amount, so a whole board can be unmetered. Scoring
 * that as 100% because every match "fully covered" an unknown quantity is how a
 * coordinator ends up believing an incident is handled when a shelter need was
 * never matched at all.
 */
export function coverageOf(needs: Need[], matches: Match[]): number {
  if (needs.length === 0) return 0

  const metered = needs.filter((n) => n.quantity != null && n.quantity > 0)
  const required = metered.reduce((sum, n) => sum + (n.quantity ?? 0), 0)

  if (required === 0) {
    const served = new Set(matches.map((m) => m.needId))
    const answered = needs.filter((n) => served.has(n.id)).length
    return Math.round((answered / needs.length) * 100) / 100
  }

  const meteredIds = new Set(metered.map((n) => n.id))
  const covered = matches
    .filter((m) => meteredIds.has(m.needId))
    .reduce((sum, m) => sum + (m.quantity ?? 0), 0)

  return Math.min(1, Math.round((covered / required) * 100) / 100)
}

export async function previewPlan(now: number = Date.now()): Promise<PlanPreview> {
  const pool = await loadPool(now)
  const plan = matchNeeds(pool.needs, pool.resources, { vehicles: pool.vehicles, now })

  return {
    ...plan,
    needsMissingCoordinates: pool.needsMissingCoordinates,
    resourcesMissingCoordinates: pool.resourcesMissingCoordinates,
    coverage: coverageOf(pool.needs, plan.matches),
    weights: DEFAULT_MATCH_WEIGHTS,
  }
}
