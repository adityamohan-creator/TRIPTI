/**
 * What the response actually achieved.
 *
 * Counted only from **verified** deliveries. A mission a volunteer marked
 * delivered but nobody confirmed is not evidence that anything reached anyone,
 * and an impact figure that includes it is a number no one can stand behind.
 *
 * These totals are the ones that end up in a report, so the arithmetic is
 * deliberately conservative: where a figure could plausibly be counted twice,
 * it is counted once.
 */

export interface DeliveryRecord {
  missionId: string
  incidentId: string
  /** Units delivered. Null for an unmetered run. */
  quantity: number | null
  unit: string | null
  kind: string
  perishable: boolean
  /** How many the incident reported as affected. Null when never stated. */
  peopleAffected: number | null
  /** When the incident was reported. */
  reportedAt: string
  /** When the delivery was confirmed. */
  verifiedAt: string
}

export interface ImpactTotals {
  /** Distinct incidents that received at least one verified delivery. */
  incidentsServed: number
  missionsCompleted: number
  /**
   * People reached, counted once per incident.
   *
   * Three deliveries to one flood of 300 people helped 300 people, not 900 —
   * and summing per mission is the single easiest way to publish a number that
   * is three times too large.
   */
  peopleHelped: number
  /** Incidents that reached someone but never said how many. */
  incidentsWithoutHeadcount: number
  mealsDelivered: number
  waterLitres: number
  /** Perishable food that reached someone instead of being thrown away. */
  foodKgRescued: number
  /** Minutes from a report arriving to its first confirmed delivery. */
  medianResponseMinutes: number | null
  fastestResponseMinutes: number | null
  slowestResponseMinutes: number | null
}

/** Units that mean a meal, however the donor wrote it. */
const MEAL_UNITS = new Set(['meal', 'meals', 'portion', 'portions', 'plate', 'plates'])
const LITRE_UNITS = new Set(['litre', 'litres', 'liter', 'liters', 'l'])
const KILO_UNITS = new Set(['kg', 'kgs', 'kilo', 'kilos', 'kilogram', 'kilograms'])

const normaliseUnit = (unit: string | null) => (unit ?? '').trim().toLowerCase()

/**
 * The median, not the mean.
 *
 * One mission that sat unverified over a weekend drags an average into
 * uselessness, and response time is exactly the figure someone will quote.
 */
export function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1]! + sorted[mid]!) / 2) * 10) / 10
    : Math.round(sorted[mid]! * 10) / 10
}

export function summariseImpact(deliveries: DeliveryRecord[]): ImpactTotals {
  const peopleByIncident = new Map<string, number | null>()
  const firstDeliveryByIncident = new Map<string, number>()

  let mealsDelivered = 0
  let waterLitres = 0
  let foodKgRescued = 0

  for (const delivery of deliveries) {
    // Last write wins, but every record for an incident carries the same
    // figure, so this is just "remember it once".
    if (!peopleByIncident.has(delivery.incidentId)) {
      peopleByIncident.set(delivery.incidentId, delivery.peopleAffected)
    }

    const reported = new Date(delivery.reportedAt).getTime()
    const verified = new Date(delivery.verifiedAt).getTime()
    const minutes = (verified - reported) / 60_000

    // Response time is measured to the *first* delivery. A later top-up did not
    // make the response slower.
    if (Number.isFinite(minutes) && minutes >= 0) {
      const existing = firstDeliveryByIncident.get(delivery.incidentId)
      if (existing === undefined || minutes < existing) {
        firstDeliveryByIncident.set(delivery.incidentId, minutes)
      }
    }

    if (delivery.quantity == null) continue
    const unit = normaliseUnit(delivery.unit)

    if (delivery.kind === 'food' && MEAL_UNITS.has(unit)) {
      mealsDelivered += delivery.quantity
    }
    if (delivery.kind === 'water' && LITRE_UNITS.has(unit)) {
      waterLitres += delivery.quantity
    }
    // Only perishable food counts as rescued: tinned goods delivered from a
    // warehouse fed people, but nothing was saved from being thrown away.
    if (delivery.perishable && delivery.kind === 'food' && KILO_UNITS.has(unit)) {
      foodKgRescued += delivery.quantity
    }
  }

  const headcounts = [...peopleByIncident.values()]
  const responseTimes = [...firstDeliveryByIncident.values()]

  return {
    incidentsServed: peopleByIncident.size,
    missionsCompleted: deliveries.length,
    peopleHelped: headcounts.reduce<number>((sum, n) => sum + (n ?? 0), 0),
    incidentsWithoutHeadcount: headcounts.filter((n) => n == null).length,
    mealsDelivered: Math.round(mealsDelivered),
    waterLitres: Math.round(waterLitres),
    foodKgRescued: Math.round(foodKgRescued * 10) / 10,
    medianResponseMinutes: median(responseTimes),
    fastestResponseMinutes: responseTimes.length ? Math.round(Math.min(...responseTimes)) : null,
    slowestResponseMinutes: responseTimes.length ? Math.round(Math.max(...responseTimes)) : null,
  }
}

export interface UtilisationInput {
  /** Every resource in the pool, with what is left and what is held. */
  resources: { quantity: number | null; reservedQuantity: number }[]
  volunteers: { availability: string }[]
  vehicles: { availability: string }[]
}

export interface Utilisation {
  /** Share of measurable stock currently promised, 0-1. */
  stockCommitted: number | null
  volunteersAvailable: number
  volunteersTotal: number
  vehiclesAvailable: number
  vehiclesTotal: number
}

/**
 * How much of the pool is working.
 *
 * Unmetered resources are left out of the stock figure rather than counted as
 * fully committed or fully idle — a rescue team has no quantity to take a
 * percentage of, and including it either way invents a number.
 */
export function summariseUtilisation(input: UtilisationInput): Utilisation {
  const metered = input.resources.filter((r) => r.quantity != null && r.quantity > 0)
  const total = metered.reduce((sum, r) => sum + (r.quantity ?? 0), 0)
  const held = metered.reduce((sum, r) => sum + r.reservedQuantity, 0)

  return {
    stockCommitted: total > 0 ? Math.round((held / total) * 100) / 100 : null,
    volunteersAvailable: input.volunteers.filter((v) => v.availability === 'available').length,
    volunteersTotal: input.volunteers.length,
    vehiclesAvailable: input.vehicles.filter((v) => v.availability === 'available').length,
    vehiclesTotal: input.vehicles.length,
  }
}

// ------------------------------------------------------------------ series

export interface DayBucket {
  /** ISO date, UTC. */
  date: string
  deliveries: number
  /** Incidents whose *first* delivery landed on this day. */
  incidentsFirstServed: number
}

/**
 * Deliveries per day, with empty days present as zeroes.
 *
 * The gaps matter. A chart drawn only from the days that have data slopes
 * smoothly between two distant points, which reads as steady work through a
 * week where nothing moved at all. Filling the range makes a quiet stretch look
 * like a quiet stretch.
 */
export function summariseTimeline(
  deliveries: DeliveryRecord[],
  from: number,
  to: number,
): DayBucket[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return []

  const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10)

  const byDay = new Map<string, { deliveries: number; incidentsFirstServed: number }>()
  const firstSeen = new Map<string, number>()

  for (const delivery of deliveries) {
    const at = new Date(delivery.verifiedAt).getTime()
    if (!Number.isFinite(at)) continue
    const existing = firstSeen.get(delivery.incidentId)
    if (existing === undefined || at < existing) firstSeen.set(delivery.incidentId, at)
  }

  const firstDays = new Map<string, number>()
  for (const at of firstSeen.values()) {
    const key = dayKey(at)
    firstDays.set(key, (firstDays.get(key) ?? 0) + 1)
  }

  for (const delivery of deliveries) {
    const at = new Date(delivery.verifiedAt).getTime()
    if (!Number.isFinite(at)) continue
    const key = dayKey(at)
    const bucket = byDay.get(key) ?? { deliveries: 0, incidentsFirstServed: 0 }
    bucket.deliveries += 1
    byDay.set(key, bucket)
  }

  const out: DayBucket[] = []
  const cursor = new Date(from)
  cursor.setUTCHours(0, 0, 0, 0)
  const end = new Date(to)
  end.setUTCHours(0, 0, 0, 0)

  // A guard, not a limit: a malformed range must not spin here.
  for (let guard = 0; cursor.getTime() <= end.getTime() && guard < 3660; guard += 1) {
    const key = cursor.toISOString().slice(0, 10)
    out.push({
      date: key,
      deliveries: byDay.get(key)?.deliveries ?? 0,
      incidentsFirstServed: firstDays.get(key) ?? 0,
    })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return out
}

export interface KindTotal {
  kind: string
  deliveries: number
  /**
   * Total delivered, or null when the kind arrived in units that cannot be
   * added together.
   *
   * Six bottles and four litres of water is not "ten" of anything. Where the
   * unit is mixed, the count of deliveries is the only figure that means
   * something, and the total is withheld rather than invented.
   */
  quantity: number | null
  unit: string | null
}

export function summariseByKind(deliveries: DeliveryRecord[]): KindTotal[] {
  const byKind = new Map<
    string,
    { deliveries: number; quantity: number; units: Set<string>; unmetered: boolean }
  >()

  for (const delivery of deliveries) {
    const entry = byKind.get(delivery.kind) ?? {
      deliveries: 0,
      quantity: 0,
      units: new Set<string>(),
      unmetered: false,
    }
    entry.deliveries += 1

    if (delivery.quantity == null) entry.unmetered = true
    else {
      entry.quantity += delivery.quantity
      entry.units.add(normaliseUnit(delivery.unit))
    }

    byKind.set(delivery.kind, entry)
  }

  return [...byKind.entries()]
    .map(([kind, entry]) => {
      // One unit across every metered delivery, and nothing unmetered hiding in
      // the total — otherwise the number would be a sum of different things.
      const addable = entry.units.size === 1 && !entry.unmetered
      const unit = addable ? [...entry.units][0]! : null
      return {
        kind,
        deliveries: entry.deliveries,
        quantity: addable ? Math.round(entry.quantity * 10) / 10 : null,
        unit: unit || null,
      }
    })
    .sort((a, b) => b.deliveries - a.deliveries || a.kind.localeCompare(b.kind))
}
