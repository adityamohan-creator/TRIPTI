/** Presentation helpers. No business rules here — only how a value reads. */

export function formatQuantity(quantity: number | null, unit: string | null): string {
  // Null quantity is not "0", it is "unmetered" — a rescue team, a doctor.
  if (quantity === null) return 'Unmetered'
  return `${quantity.toLocaleString()}${unit ? ` ${unit}` : ''}`
}

export function timeAgo(iso: string, now: number = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/**
 * How long until a deadline, or how long since it passed. Deliberately blunt
 * about expiry: "expired" is the whole point of tracking it.
 */
export function timeUntil(iso: string | null, now: number = Date.now()): string | null {
  if (!iso) return null
  const minutes = Math.round((new Date(iso).getTime() - now) / 60_000)
  if (minutes <= 0) return 'expired'
  if (minutes < 60) return `${minutes}m left`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h left`
  return `${Math.round(hours / 24)}d left`
}

export function formatCoords(lat: number | null, lon: number | null): string | null {
  if (lat == null || lon == null) return null
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`
}

/** For a datetime-local input, which wants local time with no zone suffix. */
export function toLocalInputValue(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}
