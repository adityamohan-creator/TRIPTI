import { describe, expect, it } from 'vitest'
import { type Need, type Resource, haversineKm, matchNeeds } from './match.js'
import { priorityScore } from './priority.js'

const DELHI = { lat: 28.6139, lon: 77.209 }
const NOIDA = { lat: 28.5355, lon: 77.391 }
const MUMBAI = { lat: 19.076, lon: 72.8777 }

function need(over: Partial<Need> = {}): Need {
  return {
    id: 'n1',
    incidentId: 'i1',
    kind: 'water',
    quantity: 100,
    at: DELHI,
    severity: 'medium',
    peopleAffected: 50,
    ageMinutes: 0,
    lifeCritical: false,
    unmet: true,
    ...over,
  }
}

function resource(over: Partial<Resource> = {}): Resource {
  return { id: 'r1', kind: 'water', quantity: 100, at: DELHI, ...over }
}

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm(DELHI, DELHI)).toBe(0)
  })

  it('matches the known Delhi-Mumbai distance within a percent', () => {
    expect(haversineKm(DELHI, MUMBAI)).toBeGreaterThan(1140)
    expect(haversineKm(DELHI, MUMBAI)).toBeLessThan(1170)
  })
})

describe('priorityScore', () => {
  it('ranks critical above low, all else equal', () => {
    expect(priorityScore(need({ severity: 'critical' }))).toBeGreaterThan(
      priorityScore(need({ severity: 'low' })),
    )
  })

  it('raises an ageing incident', () => {
    const fresh = priorityScore(need({ ageMinutes: 0 }))
    const stale = priorityScore(need({ ageMinutes: 240 }))
    expect(stale).toBeGreaterThan(fresh)
  })

  it('caps the age term so age never outranks severity', () => {
    const oldLow = priorityScore(need({ severity: 'low', ageMinutes: 100_000 }))
    const freshCritical = priorityScore(need({ severity: 'critical', ageMinutes: 0 }))
    expect(freshCritical).toBeGreaterThan(oldLow)
  })

  it('is deterministic', () => {
    const input = need({ severity: 'high', ageMinutes: 33, peopleAffected: 412 })
    expect(priorityScore(input)).toBe(priorityScore(input))
  })
})

describe('matchNeeds', () => {
  it('prefers the nearer of two capable resources', () => {
    const matches = matchNeeds(
      [need()],
      [resource({ id: 'far', at: MUMBAI }), resource({ id: 'near', at: NOIDA })],
    )
    expect(matches).toHaveLength(1)
    expect(matches[0]!.resourceId).toBe('near')
  })

  it('never over-commits a resource across needs', () => {
    const matches = matchNeeds(
      [
        need({ id: 'a', quantity: 80 }),
        need({ id: 'b', quantity: 80, severity: 'critical' }),
      ],
      [resource({ quantity: 100 })],
    )
    const committed = matches.reduce((sum, m) => sum + (m.quantity ?? 0), 0)
    expect(committed).toBe(100)
  })

  it('serves the higher-priority need first when supply is short', () => {
    const matches = matchNeeds(
      [
        need({ id: 'low', severity: 'low', quantity: 100 }),
        need({ id: 'crit', severity: 'critical', quantity: 100 }),
      ],
      [resource({ quantity: 100 })],
    )
    expect(matches[0]!.needId).toBe('crit')
    expect(matches[0]!.quantity).toBe(100)
  })

  it('splits one need across several resources', () => {
    const matches = matchNeeds(
      [need({ quantity: 150 })],
      [
        resource({ id: 'r1', quantity: 100 }),
        resource({ id: 'r2', quantity: 100, at: NOIDA }),
      ],
    )
    expect(matches).toHaveLength(2)
    expect(matches.reduce((s, m) => s + (m.quantity ?? 0), 0)).toBe(150)
  })

  it('ignores resources of the wrong kind', () => {
    expect(matchNeeds([need({ kind: 'water' })], [resource({ kind: 'shelter' })])).toEqual(
      [],
    )
  })

  it('assigns an unmetered resource without consuming quantity', () => {
    const matches = matchNeeds(
      [need({ kind: 'rescue', quantity: null })],
      [resource({ kind: 'rescue', quantity: null })],
    )
    expect(matches).toHaveLength(1)
    expect(matches[0]!.quantity).toBeNull()
  })

  it('returns nothing when there are no resources', () => {
    expect(matchNeeds([need()], [])).toEqual([])
  })
})
