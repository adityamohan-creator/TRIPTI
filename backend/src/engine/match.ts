import { type PriorityInput, priorityScore } from './priority.js'

export interface Coords {
  lat: number
  lon: number
}

export interface Need extends PriorityInput {
  id: string
  incidentId: string
  kind: string
  quantity: number | null
  at: Coords
}

export interface Resource {
  id: string
  kind: string
  /** Units available now. Null means unmetered (e.g. a rescue team). */
  quantity: number | null
  at: Coords
}

export interface Match {
  needId: string
  resourceId: string
  /** Units this resource commits to this need. Null mirrors an unmetered resource. */
  quantity: number | null
  distanceKm: number
  needPriority: number
}

/** Great-circle distance in km. Good enough for ranking; routing gives real ETAs. */
export function haversineKm(a: Coords, b: Coords): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Greedy matcher for the MVP: highest-priority need first, nearest capable
 * resource wins. Deterministic and explainable — a coordinator can always see
 * why a given pairing was proposed. Swap in OR-Tools when multi-stop routing
 * and vehicle capacity start to matter.
 *
 * Resource quantities are consumed as matches are made, so one truck is never
 * promised to two places.
 */
export function matchNeeds(needs: Need[], resources: Resource[]): Match[] {
  const remaining = new Map(resources.map((r) => [r.id, r.quantity]))
  const ranked = [...needs].sort((a, b) => priorityScore(b) - priorityScore(a))
  const matches: Match[] = []

  for (const need of ranked) {
    let outstanding = need.quantity

    const candidates = resources
      .filter((r) => r.kind === need.kind)
      .map((r) => ({ r, distanceKm: haversineKm(need.at, r.at) }))
      .sort((a, b) => a.distanceKm - b.distanceKm)

    for (const { r, distanceKm } of candidates) {
      // `remaining` is keyed off the same resource list, so a miss here means the
      // caller passed duplicate ids — skip rather than double-commit.
      if (!remaining.has(r.id)) continue
      const left = remaining.get(r.id) ?? null

      const record = (quantity: number | null) => {
        matches.push({
          needId: need.id,
          resourceId: r.id,
          quantity,
          distanceKm: Math.round(distanceKm * 100) / 100,
          needPriority: priorityScore(need),
        })
      }

      // Either side unmetered: assign it whole and move to the next need.
      if (left === null || outstanding === null) {
        record(outstanding)
        if (left !== null && outstanding !== null) remaining.set(r.id, left - outstanding)
        outstanding = 0
        break
      }

      if (left <= 0) continue

      const take = Math.min(left, outstanding)
      record(take)
      remaining.set(r.id, left - take)
      outstanding -= take
      if (outstanding <= 0) break
    }
  }

  return matches
}
