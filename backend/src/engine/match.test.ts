import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MATCH_WEIGHTS,
  type Need,
  type Resource,
  type Vehicle,
  haversineKm,
  matchNeeds,
  reachableInTime,
  travelHours,
} from './match.js'

const DELHI = { lat: 28.6139, lon: 77.209 }
const NOIDA = { lat: 28.5355, lon: 77.391 }
const MUMBAI = { lat: 19.076, lon: 72.8777 }

const NOW = Date.parse('2026-09-09T12:00:00Z')
const hoursFromNow = (h: number) => new Date(NOW + h * 3600_000).toISOString()

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
  return {
    id: 'r1',
    kind: 'water',
    quantity: 100,
    reservedQuantity: 0,
    at: DELHI,
    expiryTime: null,
    perishable: false,
    ...over,
  }
}

const run = (needs: Need[], resources: Resource[], vehicles?: Vehicle[]) =>
  matchNeeds(needs, resources, { now: NOW, vehicles })

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm(DELHI, DELHI)).toBe(0)
  })

  it('matches the known Delhi-Mumbai distance within a percent', () => {
    expect(haversineKm(DELHI, MUMBAI)).toBeGreaterThan(1140)
    expect(haversineKm(DELHI, MUMBAI)).toBeLessThan(1170)
  })
})

describe('match weights', () => {
  it('sum to one, so a score reads as a percentage', () => {
    const total = Object.values(DEFAULT_MATCH_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('account for the whole score across the terms', () => {
    const { matches } = run([need()], [resource()])
    const summed = matches[0]!.terms.reduce((s, t) => s + t.points, 0)
    expect(summed).toBeCloseTo(matches[0]!.score, 1)
  })

  it('report every term, so nothing is hidden from the coordinator', () => {
    const { matches } = run([need()], [resource()])
    expect(matches[0]!.terms.map((t) => t.key)).toEqual([
      'needPriority',
      'proximity',
      'quantityFit',
      'timeFit',
      'transportFit',
    ])
  })
})

describe('allocation', () => {
  it('prefers the nearer of two otherwise identical resources', () => {
    const { matches } = run(
      [need()],
      [resource({ id: 'far', at: MUMBAI }), resource({ id: 'near', at: NOIDA })],
    )
    expect(matches[0]!.resourceId).toBe('near')
  })

  it('never over-commits a resource across needs', () => {
    const { matches } = run(
      [need({ id: 'a', quantity: 80 }), need({ id: 'b', quantity: 80, severity: 'critical' })],
      [resource({ quantity: 100 })],
    )
    expect(matches.reduce((s, m) => s + (m.quantity ?? 0), 0)).toBe(100)
  })

  it('respects quantity already reserved by another plan', () => {
    // 100 in stock, 70 promised elsewhere — only 30 may be offered here.
    const { matches, unmatched } = run(
      [need({ quantity: 100 })],
      [resource({ quantity: 100, reservedQuantity: 70 })],
    )
    expect(matches.reduce((s, m) => s + (m.quantity ?? 0), 0)).toBe(30)
    expect(unmatched[0]!.reason).toMatch(/short by 70/i)
  })

  it('serves the higher-priority need first when supply is short', () => {
    const { matches } = run(
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
    const { matches } = run(
      [need({ quantity: 150 })],
      [resource({ id: 'r1', quantity: 100 }), resource({ id: 'r2', quantity: 100, at: NOIDA })],
    )
    expect(matches).toHaveLength(2)
    expect(matches.reduce((s, m) => s + (m.quantity ?? 0), 0)).toBe(150)
  })

  it('ignores resources of the wrong kind', () => {
    const { matches, unmatched } = run([need({ kind: 'water' })], [resource({ kind: 'shelter' })])
    expect(matches).toEqual([])
    expect(unmatched[0]!.reason).toMatch(/no water is available/i)
  })

  it('assigns an unmetered resource without consuming quantity', () => {
    const { matches } = run(
      [need({ kind: 'rescue', quantity: null })],
      [resource({ kind: 'rescue', quantity: null })],
    )
    expect(matches).toHaveLength(1)
    expect(matches[0]!.quantity).toBeNull()
  })

  it('reports a shortfall rather than silently under-delivering', () => {
    const { unmatched } = run([need({ quantity: 500 })], [resource({ quantity: 100 })])
    expect(unmatched[0]!.reason).toMatch(/short by 400/i)
  })

  it('returns nothing when there are no resources', () => {
    const { matches, unmatched } = run([need()], [])
    expect(matches).toEqual([])
    expect(unmatched).toHaveLength(1)
  })
})

describe('food rescue — expiry', () => {
  const perishable = (over: Partial<Resource> = {}) =>
    resource({ kind: 'food', perishable: true, ...over })

  it('never puts expired stock in a plan', () => {
    const { matches, unmatched } = run(
      [need({ kind: 'food' })],
      [perishable({ expiryTime: hoursFromNow(-1) })],
    )
    expect(matches).toEqual([])
    expect(unmatched[0]!.reason).toMatch(/expired/i)
  })

  it('prefers stock that expires sooner, all else equal', () => {
    const { matches } = run(
      [need({ kind: 'food' })],
      [
        perishable({ id: 'tomorrow', expiryTime: hoursFromNow(30) }),
        perishable({ id: 'tonight', expiryTime: hoursFromNow(4) }),
      ],
    )
    // The whole point of food rescue: use what is about to be lost.
    expect(matches[0]!.resourceId).toBe('tonight')
  })

  it('excludes stock that cannot be reached before it expires', () => {
    // Mumbai is ~1150km from Delhi — many hours away, with 30 minutes left.
    const { matches, unmatched } = run(
      [need({ kind: 'food' })],
      [perishable({ at: MUMBAI, expiryTime: hoursFromNow(0.5) })],
    )
    expect(matches).toEqual([])
    expect(unmatched[0]!.reason).toMatch(/before it expires/i)
  })

  it('does not penalise a non-perishable for having no deadline', () => {
    const { matches } = run([need({ kind: 'food' })], [resource({ kind: 'food' })])
    const time = matches[0]!.terms.find((t) => t.key === 'timeFit')!
    expect(time.normalised).toBe(1)
    expect(time.detail).toMatch(/does not expire/i)
  })

  it('lets a nearby fresh item beat a distant expiring one when the trip is too far', () => {
    const { matches } = run(
      [need({ kind: 'food' })],
      [
        perishable({ id: 'far-urgent', at: MUMBAI, expiryTime: hoursFromNow(40) }),
        perishable({ id: 'near', at: DELHI, expiryTime: hoursFromNow(30) }),
      ],
    )
    expect(matches[0]!.resourceId).toBe('near')
  })
})

describe('reachableInTime', () => {
  it('is always true for something that does not expire', () => {
    expect(reachableInTime(resource(), 500, NOW)).toBe(true)
  })

  it('is true when there is more time left than the trip takes', () => {
    const r = resource({ perishable: true, expiryTime: hoursFromNow(5) })
    expect(travelHours(25)).toBe(1)
    expect(reachableInTime(r, 25, NOW)).toBe(true)
  })

  it('is false when the trip outlasts the deadline', () => {
    const r = resource({ perishable: true, expiryTime: hoursFromNow(1) })
    expect(reachableInTime(r, 100, NOW)).toBe(false)
  })
})

describe('transport fit', () => {
  const vehicle = (over: Partial<Vehicle> = {}): Vehicle => ({
    id: 'v1',
    capacityUnits: 1000,
    refrigerated: false,
    available: true,
    ...over,
  })

  it('scores neutral and says so when no vehicles are registered', () => {
    const { matches } = run([need()], [resource()])
    const term = matches[0]!.terms.find((t) => t.key === 'transportFit')!
    expect(term.normalised).toBe(0.5)
    expect(term.detail).toMatch(/not assessed/i)
  })

  it('scores full when a capable vehicle is free', () => {
    const { matches } = run([need()], [resource()], [vehicle()])
    expect(matches[0]!.terms.find((t) => t.key === 'transportFit')!.normalised).toBe(1)
  })

  it('scores zero when perishable stock has no refrigerated vehicle', () => {
    const { matches } = run(
      [need({ kind: 'food' })],
      [resource({ kind: 'food', perishable: true, expiryTime: hoursFromNow(10) })],
      [vehicle({ refrigerated: false })],
    )
    const term = matches[0]!.terms.find((t) => t.key === 'transportFit')!
    expect(term.normalised).toBe(0)
    expect(term.detail).toMatch(/refrigerated/i)
  })

  it('scores zero when nothing free can carry the load in one run', () => {
    const { matches } = run(
      [need({ quantity: 5000 })],
      [resource({ quantity: 5000 })],
      [vehicle({ capacityUnits: 100 })],
    )
    expect(matches[0]!.terms.find((t) => t.key === 'transportFit')!.normalised).toBe(0)
  })

  it('ignores vehicles that are not available', () => {
    const { matches } = run([need()], [resource()], [vehicle({ available: false })])
    expect(matches[0]!.terms.find((t) => t.key === 'transportFit')!.detail).toMatch(
      /not assessed/i,
    )
  })
})

describe('determinism', () => {
  it('gives the same plan for the same input', () => {
    const needs = [need({ id: 'a' }), need({ id: 'b', severity: 'high' })]
    const resources = [resource({ id: 'x' }), resource({ id: 'y', at: NOIDA })]
    expect(JSON.stringify(run(needs, resources))).toBe(
      JSON.stringify(run(needs, resources)),
    )
  })
})
