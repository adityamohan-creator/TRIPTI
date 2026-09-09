import { describe, expect, it } from 'vitest'
import { geocode, type GeocodingProvider } from './geocoding.js'

const provider = (behaviour: () => Promise<unknown>): GeocodingProvider => ({
  name: 'test',
  search: behaviour as GeocodingProvider['search'],
})

describe('geocode', () => {
  it('returns what the provider found', async () => {
    const result = await geocode(
      'Sector 62 Noida',
      5,
      provider(async () => [
        { label: 'Sector 62, Noida', lat: 28.62, lon: 77.36, confidence: 0.4, source: 'test' },
      ]),
    )
    expect(result.candidates).toHaveLength(1)
    expect(result.error).toBeUndefined()
  })

  it('reports a failure instead of throwing, and invents no coordinate', async () => {
    // The caller's next move is the same either way — tell the coordinator
    // nothing was found and let them enter coordinates by hand.
    const result = await geocode(
      'Sector 62',
      5,
      provider(async () => {
        throw new Error('Nominatim returned 503')
      }),
    )
    expect(result.candidates).toEqual([])
    expect(result.error).toContain('503')
  })

  it('distinguishes "found nothing" from "failed"', async () => {
    const result = await geocode('nowhere at all', 5, provider(async () => []))
    expect(result.candidates).toEqual([])
    expect(result.error).toBeUndefined()
  })

  it('refuses a query too short to mean anything', async () => {
    let called = false
    const result = await geocode(
      'ab',
      5,
      provider(async () => {
        called = true
        return []
      }),
    )
    expect(called).toBe(false)
    expect(result.error).toMatch(/too short/i)
  })

  it('never returns an out-of-range coordinate', async () => {
    const result = await geocode(
      'broken provider',
      5,
      provider(async () => [
        { label: 'bad', lat: 999, lon: 0, confidence: null, source: 'test' },
        { label: 'good', lat: 28.6, lon: 77.2, confidence: null, source: 'test' },
      ]),
    )
    // The real provider filters these; a custom one might not, and a latitude
    // of 999 would put a marker nowhere and a truck nowhere with it.
    expect(result.candidates.every((c) => Math.abs(c.lat) <= 90)).toBe(true)
  })
})
