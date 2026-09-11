/**
 * Formatting for figures a coordinator may have to defend.
 *
 * Every helper here distinguishes "zero" from "not known". A dash reads as a
 * gap in the record; a 0 reads as a measured result, and printing one for the
 * other is the quiet way a report starts lying.
 */

export const count = (n: number) => n.toLocaleString()

/** A duration in minutes, said the way a person would say it. */
export function duration(minutes: number | null): string {
  if (minutes == null) return '—'
  if (minutes < 60) return `${Math.round(minutes)} min`
  if (minutes < 60 * 24) {
    const hours = minutes / 60
    return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hr`
  }
  const days = minutes / (60 * 24)
  return `${days < 10 ? days.toFixed(1) : Math.round(days)} days`
}

export function percent(fraction: number | null): string {
  return fraction == null ? '—' : `${Math.round(fraction * 100)}%`
}

/** A quantity with its unit, or a dash where the units could not be added. */
export function quantity(value: number | null, unit: string | null): string {
  if (value == null) return '—'
  return unit ? `${count(value)} ${unit}` : count(value)
}

/** "9 Sep" — short enough for an axis tick. */
export function shortDate(iso: string): string {
  const at = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(at.getTime())) return iso
  return at.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
}
