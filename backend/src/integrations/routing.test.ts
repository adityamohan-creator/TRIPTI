import { describe, expect, it } from 'vitest'
import type { Coords } from '../engine/match.js'
import { estimateRoute, routeStops, type RoutingProvider } from './routing.js'

const DELHI: Coords = { lat: 28.6139, lon: 77.209 }
const NOIDA: Coords = { lat: 28.5355, lon: 77.391 }

const provider = (behaviour: () => Promise<unknown>): RoutingProvider => ({
  name: 'test',
  route: behaviour as RoutingProvider['route'],
})

describe('estimateRoute', () => {
  it('produces a leg per hop', () => {
    expect(estimateRoute([DELHI, NOIDA, DELHI]).legs).toHaveLength(2)
  })

  it('is longer than the straight line, because roads are', () => {
    const straight = 19.6 // haversine Delhi -> Noida, near enough
    expect(estimateRoute([DELHI, NOIDA]).distanceKm).toBeGreaterThan(straight)
  })

  it('marks itself as an estimate and offers no geometry', () => {
    const route = estimateRoute([DELHI, NOIDA])
    expect(route.estimated).toBe(true)
    // Drawing a straight line over a map implies a road that is not there.
    expect(route.geometry).toBeNull()
  })

  it('sums its legs', () => {
    const route = estimateRoute([DELHI, NOIDA, DELHI])
    const summed = route.legs.reduce((s, l) => s + l.distanceKm, 0)
    expect(route.distanceKm).toBeCloseTo(summed, 1)
  })
})

describe('routeStops', () => {
  it('uses the provider when it works', async () => {
    const route = await routeStops(
      [DELHI, NOIDA],
      provider(async () => ({
        distanceKm: 24.1,
        durationMin: 41,
        geometry: { type: 'LineString', coordinates: [] },
        legs: [],
        provider: 'test',
        estimated: false,
      })),
    )
    expect(route.estimated).toBe(false)
    expect(route.distanceKm).toBe(24.1)
  })

  it('falls back to an estimate rather than failing a dispatch', async () => {
    const route = await routeStops(
      [DELHI, NOIDA],
      provider(async () => {
        throw new Error('OSRM returned 503')
      }),
    )
    expect(route.estimated).toBe(true)
    expect(route.distanceKm).toBeGreaterThan(0)
  })

  it('refuses a route with nowhere to go', async () => {
    await expect(routeStops([DELHI])).rejects.toThrow(/at least a pickup/i)
  })
})
