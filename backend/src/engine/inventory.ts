/**
 * Inventory arithmetic. Pure, so the rule that stops a resource being promised
 * twice is testable without a database.
 */

export interface Stocked {
  /** Null means unmetered — a rescue team, a doctor, a boat. */
  quantity: number | null
  /** Already promised to a match that has not been delivered or released yet. */
  reservedQuantity: number
}

/**
 * What can still be committed. Null propagates: an unmetered resource stays
 * unmetered no matter how many missions reference it, because "one doctor" does
 * not become "zero doctors" by being assigned.
 */
export function availableQuantity(resource: Stocked): number | null {
  if (resource.quantity === null) return null
  return Math.max(0, resource.quantity - resource.reservedQuantity)
}

/** True when this resource can still contribute anything at all. */
export function hasCapacity(resource: Stocked): boolean {
  const available = availableQuantity(resource)
  return available === null || available > 0
}

/**
 * How much of `wanted` this resource can take on, clamped to what is left.
 * Null on either side means unmetered, and an unmetered side never limits the
 * other — the caller records the request as-is.
 */
export function allocatable(resource: Stocked, wanted: number | null): number | null {
  const available = availableQuantity(resource)
  if (available === null || wanted === null) return wanted
  return Math.min(available, Math.max(0, wanted))
}

/**
 * Guard for the write path. Reserving more than is available is the specific
 * failure that puts two trucks on one promise, so it is rejected rather than
 * clamped — a caller that asked for too much has a bug worth surfacing.
 */
export function canReserve(resource: Stocked, amount: number | null): boolean {
  if (amount === null) return true
  if (amount < 0) return false
  const available = availableQuantity(resource)
  return available === null || amount <= available
}

/** Minutes until this resource is unusable. Null when it does not expire. */
export function minutesUntilExpiry(
  expiryTime: string | null,
  now: number = Date.now(),
): number | null {
  if (!expiryTime) return null
  return (new Date(expiryTime).getTime() - now) / 60_000
}

/** Past its deadline. Expired stock must never appear in a plan. */
export function isExpired(expiryTime: string | null, now: number = Date.now()): boolean {
  const minutes = minutesUntilExpiry(expiryTime, now)
  return minutes !== null && minutes <= 0
}
