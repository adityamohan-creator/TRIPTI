import {
  type DeliveryRecord,
  summariseByKind,
  summariseImpact,
  summariseTimeline,
  summariseUtilisation,
} from '../engine/impact.js'
import { admin } from '../supabase.js'

/**
 * Impact reporting.
 *
 * Computed from the operational records every time it is asked for, rather
 * than accumulated into a counter. A counter drifts: correct a mission weeks
 * later and the total still carries the old figure, with nothing to show that
 * it should not. The volumes here are a disaster response, not a telemetry
 * firehose, so recomputing costs one query and buys a number that always
 * matches the records behind it.
 *
 * `impact_metrics` exists in the schema for period snapshots and is
 * deliberately NOT the source for this — see the comment on that table.
 */

interface MissionRow {
  id: string
  quantity: number | null
  updated_at: string
  needs: {
    kind: string
    unit: string | null
    incident_id: string
    incidents: {
      people_affected: number | null
      created_at: string
    } | null
  } | null
  resources: {
    kind: string
    unit: string | null
    perishable: boolean
  } | null
}

/**
 * Every delivery that someone actually confirmed.
 *
 * Only `verified`. A mission a volunteer marked delivered but nobody confirmed
 * is not evidence that anything reached anyone, and the whole point of the
 * verification step is that the impact figures rest on it.
 */
async function loadDeliveries(): Promise<DeliveryRecord[]> {
  const [{ data: missions, error }, { data: history, error: historyError }] = await Promise.all([
    admin
      .from('missions')
      .select(
        'id, quantity, updated_at, needs(kind, unit, incident_id, incidents(people_affected, created_at)), resources(kind, unit, perishable)',
      )
      .eq('status', 'verified'),
    admin
      .from('status_history')
      .select('entity_id, changed_at')
      .eq('entity_type', 'mission')
      .eq('to_status', 'verified')
      .order('changed_at', { ascending: true }),
  ])

  if (error) throw error
  if (historyError) throw historyError

  /*
   * The append-only trail is the authoritative record of when a delivery was
   * confirmed. First write wins: a mission re-verified after a correction was
   * still first confirmed at the earlier moment, and that is the response time
   * that actually happened.
   */
  const verifiedAt = new Map<string, string>()
  for (const row of (history ?? []) as { entity_id: string; changed_at: string }[]) {
    if (!verifiedAt.has(row.entity_id)) verifiedAt.set(row.entity_id, row.changed_at)
  }

  const records: DeliveryRecord[] = []

  for (const mission of (missions ?? []) as unknown as MissionRow[]) {
    const need = mission.needs
    const incident = need?.incidents
    // A delivery with no need behind it cannot be attributed to anyone, and an
    // unattributed impact figure is one nobody can check.
    if (!need || !incident) continue

    records.push({
      missionId: mission.id,
      incidentId: need.incident_id,
      quantity: mission.quantity,
      /*
       * The resource's unit, because the mission quantity is denominated in
       * it — the need says what was wanted, the resource says what was sent.
       */
      unit: mission.resources?.unit ?? need.unit,
      kind: mission.resources?.kind ?? need.kind,
      perishable: mission.resources?.perishable ?? false,
      peopleAffected: incident.people_affected,
      reportedAt: incident.created_at,
      /*
       * `updated_at` is a sound fallback rather than a guess: `verified` is a
       * terminal state, so nothing updates the row afterwards and the timestamp
       * still marks the moment it was confirmed.
       */
      verifiedAt: verifiedAt.get(mission.id) ?? mission.updated_at,
    })
  }

  return records
}

/** How much of the pool is working right now. Live, not historical. */
async function loadUtilisation() {
  const [resources, volunteers, vehicles] = await Promise.all([
    admin.from('resources').select('quantity, reserved_quantity').eq('status', 'available'),
    admin.from('volunteers').select('availability'),
    admin.from('vehicles').select('availability'),
  ])

  if (resources.error) throw resources.error
  if (volunteers.error) throw volunteers.error
  if (vehicles.error) throw vehicles.error

  return summariseUtilisation({
    resources: (resources.data ?? []).map((r) => ({
      quantity: r.quantity,
      reservedQuantity: r.reserved_quantity ?? 0,
    })),
    volunteers: volunteers.data ?? [],
    vehicles: vehicles.data ?? [],
  })
}

export interface ImpactOptions {
  /** Days of history to report on. */
  days?: number
  /**
   * Whether to include the live pool figures.
   *
   * What was achieved is public within the organisation — a donor should be
   * able to see that their food reached people. How much slack the response
   * currently has is operational posture, and belongs to the people running it.
   */
  includeUtilisation?: boolean
}

const DEFAULT_DAYS = 30

export async function getImpact(options: ImpactOptions = {}) {
  const days = options.days ?? DEFAULT_DAYS
  const now = Date.now()
  const from = now - days * 24 * 60 * 60 * 1000

  const [deliveries, utilisation] = await Promise.all([
    loadDeliveries(),
    options.includeUtilisation ? loadUtilisation() : Promise.resolve(null),
  ])

  /*
   * Two windows, reported side by side.
   *
   * The totals a coordinator is judged on are the ones for the period they are
   * looking at, but a lifetime figure that silently shrinks when someone
   * changes the date range is the kind of number that destroys trust in the
   * rest of the page. Both are named for what they are.
   */
  const inWindow = deliveries.filter((d) => {
    const at = new Date(d.verifiedAt).getTime()
    return Number.isFinite(at) && at >= from
  })

  return {
    window: { days, from: new Date(from).toISOString(), to: new Date(now).toISOString() },
    totals: summariseImpact(inWindow),
    allTime: summariseImpact(deliveries),
    timeline: summariseTimeline(inWindow, from, now),
    byKind: summariseByKind(inWindow),
    utilisation,
  }
}
