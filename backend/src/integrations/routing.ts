import { type Coords, haversineKm, travelHours } from '../engine/match.js'

/**
 * Turning an ordered list of stops into a route.
 *
 * Behind an interface because the provider will change — OSRM's public server
 * is fine for a demo and wrong for production, and nothing above this file
 * should have to care. The straight-line fallback means a routing outage
 * degrades the ETA rather than blocking a dispatch.
 */

export interface RouteLeg {
  distanceKm: number
  durationMin: number
}

export interface Route {
  distanceKm: number
  durationMin: number
  /** GeoJSON LineString coordinates as [lon, lat], for drawing. Null when estimated. */
  geometry: { type: 'LineString'; coordinates: [number, number][] } | null
  legs: RouteLeg[]
  provider: string
  /** True when this is a straight-line estimate, not a real road route. */
  estimated: boolean
}

export interface RoutingProvider {
  readonly name: string
  route(stops: Coords[]): Promise<Route>
}

const TIMEOUT_MS = 8000

/**
 * Roads are longer than the straight line between their endpoints. 1.3 is the
 * usual rule of thumb for mixed urban driving and is only used when a real
 * route is unavailable — it is an estimate, and the result says so.
 */
const ROAD_WINDING_FACTOR = 1.3

/** OSRM's public demo server. No key, no SLA — replace before production. */
export const osrmProvider: RoutingProvider = {
  name: 'osrm',

  async route(stops) {
    const path = stops.map((s) => `${s.lon},${s.lat}`).join(';')
    const url = new URL(`https://router.project-osrm.org/route/v1/driving/${path}`)
    url.searchParams.set('overview', 'full')
    url.searchParams.set('geometries', 'geojson')

    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) throw new Error(`OSRM returned ${response.status}`)

    const body = (await response.json()) as {
      code?: string
      routes?: {
        distance: number
        duration: number
        geometry?: { type: string; coordinates: [number, number][] }
        legs?: { distance: number; duration: number }[]
      }[]
    }

    const best = body.routes?.[0]
    if (body.code !== 'Ok' || !best) {
      throw new Error(`OSRM could not route these stops (${body.code ?? 'no route'})`)
    }

    return {
      distanceKm: Math.round((best.distance / 1000) * 100) / 100,
      durationMin: Math.round(best.duration / 60),
      geometry:
        best.geometry?.type === 'LineString'
          ? { type: 'LineString', coordinates: best.geometry.coordinates }
          : null,
      legs: (best.legs ?? []).map((leg) => ({
        distanceKm: Math.round((leg.distance / 1000) * 100) / 100,
        durationMin: Math.round(leg.duration / 60),
      })),
      provider: 'osrm',
      estimated: false,
    }
  },
}

/**
 * Straight lines with a winding factor.
 *
 * Always available, needs no network, and is honest about being an estimate.
 * A coordinator seeing "estimated" knows the ETA is indicative; a coordinator
 * seeing nothing at all cannot dispatch.
 */
export function estimateRoute(stops: Coords[]): Route {
  const legs: RouteLeg[] = []

  for (let i = 1; i < stops.length; i++) {
    const km = haversineKm(stops[i - 1]!, stops[i]!) * ROAD_WINDING_FACTOR
    legs.push({
      distanceKm: Math.round(km * 100) / 100,
      durationMin: Math.round(travelHours(km) * 60),
    })
  }

  return {
    distanceKm: Math.round(legs.reduce((s, l) => s + l.distanceKm, 0) * 100) / 100,
    durationMin: legs.reduce((s, l) => s + l.durationMin, 0),
    // Deliberately no geometry: drawing a straight line over a map implies a
    // road that is not there. The map draws a dashed direct line instead, which
    // reads as "we do not know the way" rather than "this is the way".
    geometry: null,
    legs,
    provider: 'straight-line-estimate',
    estimated: true,
  }
}

/**
 * Routes the stops, falling back to an estimate.
 *
 * Never throws: a mission that cannot be routed is still a mission worth
 * dispatching, and the volunteer knows the roads better than OSRM does.
 */
export async function routeStops(
  stops: Coords[],
  provider: RoutingProvider = osrmProvider,
): Promise<Route> {
  if (stops.length < 2) {
    throw new Error('A route needs at least a pickup and a dropoff')
  }

  try {
    return await provider.route(stops)
  } catch (err) {
    console.error(
      'Routing failed, falling back to a straight-line estimate:',
      err instanceof Error ? err.message : err,
    )
    return estimateRoute(stops)
  }
}
