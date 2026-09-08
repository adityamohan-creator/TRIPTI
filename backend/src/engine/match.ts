import { availableQuantity, isExpired, minutesUntilExpiry } from './inventory.js'
import { type PriorityInput, priorityBreakdown } from './priority.js'

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
  /** Already promised to a live match and not yet delivered. */
  reservedQuantity: number
  at: Coords
  /** ISO timestamp. Null when the resource does not expire. */
  expiryTime: string | null
  perishable: boolean
}

/** What the fleet can do. Empty is a normal state, not an error. */
export interface Vehicle {
  id: string
  capacityUnits: number | null
  refrigerated: boolean
  available: boolean
}

/**
 * Weights from the PRD, §12. They sum to 1, so a match score reads as a
 * percentage rather than a number on an invented scale, and every term can be
 * compared against every other.
 */
export interface MatchWeights {
  needPriority: number
  proximity: number
  quantityFit: number
  timeFit: number
  transportFit: number
}

export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  needPriority: 0.3,
  proximity: 0.25,
  quantityFit: 0.2,
  timeFit: 0.15,
  transportFit: 0.1,
}

export interface MatchTerm {
  key: keyof MatchWeights
  label: string
  normalised: number
  weight: number
  points: number
  detail: string
}

export interface Match {
  needId: string
  resourceId: string
  /** Units this resource commits to this need. Null mirrors an unmetered resource. */
  quantity: number | null
  distanceKm: number
  /** 0-100. */
  score: number
  needPriority: number
  terms: MatchTerm[]
}

export interface MatchPlan {
  matches: Match[]
  /** Needs that got nothing, and the reason a coordinator can act on. */
  unmatched: { needId: string; reason: string }[]
}

export interface MatchOptions {
  weights?: MatchWeights
  vehicles?: Vehicle[]
  now?: number
}

/** Beyond this a delivery stops being a sensible first choice. */
const PROXIMITY_CEILING_KM = 50

/** Rough urban average including loading. Only used to test feasibility. */
const TRAVEL_KMH = 25

/** Expiry pressure is scored across this window; sooner is more urgent. */
const EXPIRY_WINDOW_HOURS = 48

const round2 = (n: number) => Math.round(n * 100) / 100
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

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

export function travelHours(distanceKm: number): number {
  return distanceKm / TRAVEL_KMH
}

/**
 * Can this resource physically reach this need before it is unusable?
 *
 * A hard gate rather than a low score: dispatching a volunteer to collect food
 * that will have expired before they arrive wastes the trip and the food. Only
 * perishable stock is gated — a blanket has no deadline to miss.
 */
export function reachableInTime(
  resource: Resource,
  distanceKm: number,
  now: number,
): boolean {
  if (!resource.perishable || !resource.expiryTime) return true
  const minutesLeft = minutesUntilExpiry(resource.expiryTime, now)
  if (minutesLeft === null) return true
  return minutesLeft / 60 >= travelHours(distanceKm)
}

/**
 * Time fit is the food-rescue term. Among stock that *can* be delivered in time,
 * the closer something is to expiring the higher it scores — that is the whole
 * point of rescuing surplus food, and it is why a tray of cooked meals with four
 * hours left outranks tinned food with a year.
 *
 * Non-perishables score 1: nothing about them is time-critical, so they never
 * lose ground to a deadline they do not have.
 */
function timeFit(resource: Resource, now: number): { value: number; detail: string } {
  if (!resource.perishable || !resource.expiryTime) {
    return { value: 1, detail: 'Does not expire.' }
  }

  const hoursLeft = (minutesUntilExpiry(resource.expiryTime, now) ?? 0) / 60
  const urgency = clamp01(1 - hoursLeft / EXPIRY_WINDOW_HOURS)

  return {
    value: urgency,
    detail: `${hoursLeft < 1 ? 'Under an hour' : `${Math.round(hoursLeft)}h`} before it is unusable — rescue it first.`,
  }
}

/**
 * Whether the fleet can actually carry this.
 *
 * With no vehicles registered the honest answer is "not assessed", which scores
 * neutral rather than pretending transport is solved. It becomes a real
 * constraint once vehicles and volunteer assignment exist.
 */
function transportFit(
  resource: Resource,
  amount: number | null,
  vehicles: Vehicle[],
): { value: number; detail: string } {
  const usable = vehicles.filter((v) => v.available)

  if (usable.length === 0) {
    return { value: 0.5, detail: 'No vehicles registered, so transport is not assessed.' }
  }

  const capable = usable.filter((v) => {
    if (resource.perishable && !v.refrigerated) return false
    if (amount === null || v.capacityUnits === null) return true
    return v.capacityUnits >= amount
  })

  if (capable.length === 0) {
    return {
      value: 0,
      detail: resource.perishable
        ? 'No refrigerated vehicle is free for this load.'
        : 'No available vehicle can carry this quantity in one run.',
    }
  }

  return {
    value: 1,
    detail: `${capable.length} suitable vehicle${capable.length === 1 ? '' : 's'} available.`,
  }
}

function scoreMatch(
  need: Need,
  resource: Resource,
  distanceKm: number,
  amount: number | null,
  outstanding: number | null,
  weights: MatchWeights,
  vehicles: Vehicle[],
  now: number,
): { score: number; terms: MatchTerm[] } {
  const priority = priorityBreakdown(need).score / 100
  const proximity = clamp01(1 - distanceKm / PROXIMITY_CEILING_KM)

  // How much of what is still outstanding this one resource covers. Unmetered
  // on either side means the question does not apply, so it does not penalise.
  const coverage =
    outstanding === null || amount === null || outstanding <= 0
      ? 1
      : clamp01(amount / outstanding)

  const time = timeFit(resource, now)
  const transport = transportFit(resource, amount, vehicles)

  const raw: [keyof MatchWeights, string, number, string][] = [
    [
      'needPriority',
      'Need priority',
      priority,
      `The need scores ${Math.round(priority * 100)} on its own.`,
    ],
    [
      'proximity',
      'Proximity',
      proximity,
      `${distanceKm.toFixed(1)} km away, about ${Math.round(travelHours(distanceKm) * 60)} minutes.`,
    ],
    [
      'quantityFit',
      'Quantity fit',
      coverage,
      outstanding === null || amount === null
        ? 'Unmetered, so quantity does not constrain this.'
        : `Covers ${Math.round(coverage * 100)}% of what is still outstanding.`,
    ],
    ['timeFit', 'Time fit', time.value, time.detail],
    ['transportFit', 'Transport fit', transport.value, transport.detail],
  ]

  const terms: MatchTerm[] = raw.map(([key, label, normalised, detail]) => ({
    key,
    label,
    normalised: round2(normalised),
    weight: weights[key],
    points: round2(normalised * weights[key] * 100),
    detail,
  }))

  return { score: round2(terms.reduce((sum, t) => sum + t.points, 0)), terms }
}

/**
 * Proposes need-to-resource pairings.
 *
 * Highest-priority need first; for each, every capable resource is scored and
 * the best takes as much as it can, then the next fills the remainder. Greedy
 * rather than globally optimal — a coordinator has to be able to follow the
 * reasoning, and every pairing carries the arithmetic that produced it.
 *
 * Resource quantities are consumed as matches are made, so one truck is never
 * promised to two places within a plan. Across plans that guarantee comes from
 * the reservation in the database, not from here.
 */
export function matchNeeds(
  needs: Need[],
  resources: Resource[],
  options: MatchOptions = {},
): MatchPlan {
  const weights = options.weights ?? DEFAULT_MATCH_WEIGHTS
  const vehicles = options.vehicles ?? []
  const now = options.now ?? Date.now()

  const remaining = new Map(
    resources.map((r) => [
      r.id,
      availableQuantity({ quantity: r.quantity, reservedQuantity: r.reservedQuantity }),
    ]),
  )

  const ranked = [...needs].sort(
    (a, b) => priorityBreakdown(b).score - priorityBreakdown(a).score,
  )

  const matches: Match[] = []
  const unmatched: MatchPlan['unmatched'] = []

  for (const need of ranked) {
    let outstanding = need.quantity
    const before = matches.length
    let sawExpired = false
    let sawUnreachable = false

    // Rescore on every pass: taking stock changes what the next-best option is.
    while (outstanding === null || outstanding > 0) {
      const candidates = resources
        .filter((r) => r.kind === need.kind)
        .filter((r) => {
          const left = remaining.get(r.id)
          return left === null || (left ?? 0) > 0
        })
        .filter((r) => {
          // Expired stock never enters a plan. This is a safety rule, not a
          // preference, so it is a filter and not a low score.
          if (isExpired(r.expiryTime, now)) {
            sawExpired = true
            return false
          }
          return true
        })
        .map((r) => ({ r, distanceKm: haversineKm(need.at, r.at) }))
        .filter(({ r, distanceKm }) => {
          if (!reachableInTime(r, distanceKm, now)) {
            sawUnreachable = true
            return false
          }
          return true
        })
        .filter(({ r }) => !matches.some((m) => m.needId === need.id && m.resourceId === r.id))

      if (candidates.length === 0) break

      const scored = candidates
        .map(({ r, distanceKm }) => {
          const left = remaining.get(r.id) ?? null
          const amount =
            left === null || outstanding === null ? outstanding : Math.min(left, outstanding)
          const { score, terms } = scoreMatch(
            need,
            r,
            distanceKm,
            amount,
            outstanding,
            weights,
            vehicles,
            now,
          )
          return { r, distanceKm, amount, score, terms }
        })
        .sort((a, b) => b.score - a.score || a.distanceKm - b.distanceKm)

      const best = scored[0]!

      matches.push({
        needId: need.id,
        resourceId: best.r.id,
        quantity: best.amount,
        distanceKm: round2(best.distanceKm),
        score: best.score,
        needPriority: priorityBreakdown(need).score,
        terms: best.terms,
      })

      const left = remaining.get(best.r.id) ?? null
      if (left === null || outstanding === null) {
        // Either side unmetered: assign it whole and move on.
        outstanding = 0
        break
      }

      remaining.set(best.r.id, left - (best.amount ?? 0))
      outstanding -= best.amount ?? 0
    }

    if (matches.length === before) {
      unmatched.push({
        needId: need.id,
        reason: sawExpired
          ? `No usable ${need.kind} — the only stock of that kind has expired.`
          : sawUnreachable
            ? `No ${need.kind} can be delivered before it expires.`
            : `No ${need.kind} is available.`,
      })
    } else if (outstanding !== null && outstanding > 0) {
      unmatched.push({
        needId: need.id,
        reason: `Short by ${outstanding} — the pool does not hold enough ${need.kind}.`,
      })
    }
  }

  return { matches, unmatched }
}
