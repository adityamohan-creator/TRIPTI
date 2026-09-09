/**
 * Turning a place name into coordinates.
 *
 * The hard rule this file exists to protect: **coordinates are never inferred**.
 * Extraction copies the place name into `location_text` and leaves lat/lon null;
 * this returns *candidates* for a coordinator to choose from, and only their
 * choice is written. A wrong coordinate in a disaster sends a truck to the wrong
 * place, and the model has no way to know it guessed wrong.
 *
 * So: nothing here writes to the database, and nothing auto-applies a result.
 */

export interface GeocodeCandidate {
  label: string
  lat: number
  lon: number
  /** The provider's own confidence, 0-1, where it reports one. */
  confidence: number | null
  source: string
}

export interface GeocodingProvider {
  readonly name: string
  search(query: string, limit: number): Promise<GeocodeCandidate[]>
}

const TIMEOUT_MS = 8000

/**
 * OpenStreetMap Nominatim. Free, no key, and rate limited to roughly one
 * request a second — which is why this is only ever called from an explicit
 * coordinator action, never in a loop over a board.
 *
 * Their usage policy requires a real User-Agent identifying the application.
 */
export const nominatimProvider: GeocodingProvider = {
  name: 'nominatim',

  async search(query, limit) {
    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('limit', String(limit))
    url.searchParams.set('addressdetails', '0')

    const response = await fetch(url, {
      headers: { 'User-Agent': 'TRIPTI disaster-response coordination (self-hosted)' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })

    if (!response.ok) throw new Error(`Nominatim returned ${response.status}`)

    const rows = (await response.json()) as {
      display_name?: string
      lat?: string
      lon?: string
      importance?: number
    }[]

    if (!Array.isArray(rows)) throw new Error('Nominatim returned an unexpected shape')

    return rows
      .map((row) => ({
        label: row.display_name ?? query,
        lat: Number(row.lat),
        lon: Number(row.lon),
        confidence:
          typeof row.importance === 'number' ? Math.min(1, Math.max(0, row.importance)) : null,
        source: 'nominatim',
      }))
      .filter(
        (c) =>
          Number.isFinite(c.lat) &&
          Number.isFinite(c.lon) &&
          Math.abs(c.lat) <= 90 &&
          Math.abs(c.lon) <= 180,
      )
  },
}

/**
 * A coordinate that is actually on Earth.
 *
 * Checked here rather than only in the Nominatim adapter: the whole point of
 * the provider interface is that another implementation can be dropped in, and
 * a guard that lives in one adapter protects only that adapter. A latitude of
 * 999 puts a marker nowhere, and a truck nowhere with it.
 */
function isPlausible(candidate: GeocodeCandidate): boolean {
  return (
    Number.isFinite(candidate.lat) &&
    Number.isFinite(candidate.lon) &&
    Math.abs(candidate.lat) <= 90 &&
    Math.abs(candidate.lon) <= 180
  )
}

export interface GeocodeResult {
  candidates: GeocodeCandidate[]
  provider: string
  /** Set when lookup failed. An empty list and a failure are different things. */
  error?: string
}

/**
 * Looks a place up.
 *
 * A failure returns an empty candidate list *with* an error rather than
 * throwing, because the caller's next move is the same either way: show the
 * coordinator that nothing was found and let them enter coordinates by hand.
 * What it must never do is invent a fallback coordinate.
 */
export async function geocode(
  query: string,
  limit = 5,
  provider: GeocodingProvider = nominatimProvider,
): Promise<GeocodeResult> {
  const trimmed = query.trim()
  if (trimmed.length < 3) {
    return { candidates: [], provider: provider.name, error: 'Query is too short to look up.' }
  }

  try {
    const found = await provider.search(trimmed, limit)
    return { candidates: found.filter(isPlausible), provider: provider.name }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lookup failed'
    console.error('Geocoding failed:', message)
    return { candidates: [], provider: provider.name, error: message }
  }
}
