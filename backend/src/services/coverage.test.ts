import { describe, expect, it } from 'vitest'
import type { Match, Need } from '../engine/match.js'
import { coverageOf } from './matching.service.js'

const need = (id: string, quantity: number | null): Need => ({
  id,
  incidentId: 'i1',
  kind: 'water',
  quantity,
  at: { lat: 0, lon: 0 },
  severity: 'medium',
  peopleAffected: null,
  ageMinutes: 0,
  lifeCritical: false,
  unmet: true,
})

const match = (needId: string, quantity: number | null): Match => ({
  needId,
  resourceId: 'r1',
  quantity,
  distanceKm: 1,
  score: 50,
  needPriority: 40,
  terms: [],
})

describe('coverageOf', () => {
  it('measures by quantity when quantities are known', () => {
    expect(coverageOf([need('a', 600)], [match('a', 300)])).toBe(0.5)
  })

  it('reaches 1 only when the quantity is actually met', () => {
    expect(coverageOf([need('a', 600)], [match('a', 600)])).toBe(1)
  })

  it('falls back to how many needs were answered when nothing is metered', () => {
    // The exact case that made a plan claim 100% while a shelter need went
    // unmatched: three unmetered needs, two of them served.
    const needs = [need('a', null), need('b', null), need('c', null)]
    expect(coverageOf(needs, [match('a', null), match('b', null)])).toBe(0.67)
  })

  it('is zero when an unmetered board gets nothing', () => {
    expect(coverageOf([need('a', null), need('b', null)], [])).toBe(0)
  })

  it('is zero when there is nothing to cover', () => {
    expect(coverageOf([], [])).toBe(0)
  })

  it('never exceeds 1 when a need is over-served', () => {
    expect(coverageOf([need('a', 100)], [match('a', 250)])).toBe(1)
  })
})
