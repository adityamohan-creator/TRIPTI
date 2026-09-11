/**
 * Live disaster alerts from outside the system.
 *
 * The hard rule this file exists to protect: **nothing here is news the
 * software wrote.** Every field is copied from a named external feed and
 * carries a link back to it, so a coordinator acting on one can check the
 * source. An LLM is never asked what is happening in the world — it cannot
 * know, and a fabricated flood sends real people to a place that is fine while
 * the real one goes unanswered.
 *
 * Alerts are context, not incidents. They are never written to `incidents`
 * automatically: a coordinator reads one and decides. See `routes/feed.ts`.
 */

export type AlertLevel = 'green' | 'orange' | 'red'

/** GDACS event codes, mapped to something a person reads. */
const EVENT_TYPES: Record<string, string> = {
  EQ: 'earthquake',
  TC: 'cyclone',
  FL: 'flood',
  VO: 'volcano',
  DR: 'drought',
  WF: 'wildfire',
  TS: 'tsunami',
}

export interface DisasterAlert {
  id: string
  /** One of EVENT_TYPES, or the raw code when the feed adds a new one. */
  kind: string
  title: string
  summary: string
  level: AlertLevel
  country: string | null
  lat: number | null
  lon: number | null
  /**
   * The feed's own sentence about human impact, shown verbatim.
   *
   * Not a number, deliberately. GDACS puts a `value` on every alert, but it
   * means a different thing per event type: people exposed to shaking for an
   * earthquake, population inside Category 1 winds for a cyclone, and — for a
   * flood — a *death count* under the unit "Population Affected". Rendering
   * them all under one label would have printed a death toll as people helped.
   *
   * There is no unit these can be compared in, so they are not compared. The
   * wording GDACS chose is the only honest presentation.
   */
  impactLabel: string | null
  severity: string | null
  publishedAt: string
  /** Back to the source. Always present — an alert nobody can check is a rumour. */
  url: string
  source: string
}

export interface DisasterFeedProvider {
  readonly name: string
  fetchAlerts(): Promise<DisasterAlert[]>
}

/*
 * Generous, because the payload is around a megabyte of RSS and the first call
 * after a cold start pays for DNS and TLS on top. Measured at 2-6s from here,
 * with the slowest observed run near 10 — a tighter limit turns a working feed
 * into an intermittent one. The service caches for five minutes, so this cost
 * is paid once per twelve open maps, not once per page load.
 */
const TIMEOUT_MS = 20_000

/** Pulls the first capture group, or null. XML here is small and flat. */
function tag(xml: string, name: string): string | null {
  const match = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
  return match?.[1] ?? null
}

function decode(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
}

function toNumber(value: string | null): number | null {
  if (value === null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** Coordinates outside the possible range are dropped, never clamped. */
function plausible(lat: number | null, lon: number | null): boolean {
  return (
    lat !== null &&
    lon !== null &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    // 0,0 is the Atlantic. A feed emitting it means "unknown", not "here".
    !(lat === 0 && lon === 0)
  )
}

/**
 * GDACS — the Global Disaster Alert and Coordination System, run jointly by the
 * UN and the European Commission.
 *
 * Chosen because it is free, needs no key, and is already structured: alert
 * level, coordinates and event type all arrive as fields rather than prose.
 * There is nothing here for a model to interpret, which is the point.
 */
export const gdacsProvider: DisasterFeedProvider = {
  name: 'gdacs',

  async fetchAlerts() {
    const response = await fetch('https://www.gdacs.org/xml/rss.xml', {
      headers: { 'User-Agent': 'TRIPTI disaster-response coordination (self-hosted)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!response.ok) throw new Error(`GDACS returned ${response.status}`)

    const xml = await response.text()
    const items = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? []
    const alerts: DisasterAlert[] = []

    for (const item of items) {
      const id = tag(item, 'gdacs:eventid')
      const url = tag(item, 'link')
      // Without an id or a source link it cannot be deduplicated or checked.
      if (!id || !url) continue

      const code = (tag(item, 'gdacs:eventtype') ?? '').toUpperCase()
      const level = (tag(item, 'gdacs:alertlevel') ?? 'green').toLowerCase()
      const lat = toNumber(tag(item, 'geo:lat'))
      const lon = toNumber(tag(item, 'geo:long'))
      const located = plausible(lat, lon)

      alerts.push({
        id: `gdacs-${id}`,
        kind: EVENT_TYPES[code] ?? code.toLowerCase() ?? 'other',
        title: decode(tag(item, 'title') ?? 'Untitled alert'),
        summary: decode(tag(item, 'description') ?? ''),
        level: (['green', 'orange', 'red'].includes(level) ? level : 'green') as AlertLevel,
        country: decode(tag(item, 'gdacs:country') ?? '') || null,
        lat: located ? lat : null,
        lon: located ? lon : null,
        impactLabel: decode(tag(item, 'gdacs:population') ?? '') || null,
        severity: decode(tag(item, 'gdacs:severity') ?? '') || null,
        publishedAt: new Date(tag(item, 'pubDate') ?? Date.now()).toISOString(),
        url: decode(url),
        source: 'GDACS',
      })
    }

    // Worst first, then newest. A coordinator scanning this reads top down.
    const rank: Record<AlertLevel, number> = { red: 0, orange: 1, green: 2 }
    return alerts.sort(
      (a, b) =>
        rank[a.level] - rank[b.level] ||
        Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
    )
  },
}
