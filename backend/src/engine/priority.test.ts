import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WEIGHTS,
  type PriorityInput,
  priorityBreakdown,
  priorityLevel,
  priorityScore,
} from './priority.js'

function input(over: Partial<PriorityInput> = {}): PriorityInput {
  return {
    severity: 'medium',
    peopleAffected: 50,
    ageMinutes: 0,
    lifeCritical: false,
    unmet: true,
    ...over,
  }
}

describe('priority weights', () => {
  it('sums to one, so the score reads as a percentage', () => {
    const total = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('never exceeds 100 even when every term is maxed', () => {
    const worst = priorityScore(
      input({
        severity: 'critical',
        peopleAffected: 5_000_000,
        ageMinutes: 100_000,
        lifeCritical: true,
        vulnerable: true,
        shortageRatio: 1,
      }),
    )
    expect(worst).toBeLessThanOrEqual(100)
    expect(worst).toBeCloseTo(100, 1)
  })

  it('is zero-ish when nothing is known and nothing is wrong', () => {
    const best = priorityScore(
      input({
        severity: 'low',
        peopleAffected: null,
        ageMinutes: 0,
        unmet: false,
        shortageRatio: 0,
      }),
    )
    expect(best).toBeGreaterThan(0)
    expect(best).toBeLessThan(20)
  })
})

describe('priorityBreakdown', () => {
  it('accounts for the whole score across its terms', () => {
    const breakdown = priorityBreakdown(input({ severity: 'high', vulnerable: true }))
    const summed = breakdown.terms.reduce((sum, t) => sum + t.points, 0)
    expect(summed).toBeCloseTo(breakdown.score, 1)
  })

  it('reports every weighted term, so nothing is hidden from the coordinator', () => {
    const keys = priorityBreakdown(input()).terms.map((t) => t.key)
    expect(keys).toEqual([
      'severity',
      'peopleAffected',
      'urgency',
      'shortage',
      'vulnerability',
    ])
  })

  it('explains a missing figure instead of scoring it as zero silently', () => {
    const term = priorityBreakdown(input({ peopleAffected: null })).terms.find(
      (t) => t.key === 'peopleAffected',
    )
    expect(term!.points).toBe(0)
    expect(term!.detail).toMatch(/no figure reported/i)
  })

  it('says why urgency is at its maximum for a life-critical need', () => {
    const term = priorityBreakdown(input({ lifeCritical: true })).terms.find(
      (t) => t.key === 'urgency',
    )
    expect(term!.normalised).toBe(1)
    expect(term!.detail).toMatch(/life-threatening/i)
  })

  it('honours custom weights, so the balance is an operational decision', () => {
    const peopleOnly = {
      severity: 0,
      peopleAffected: 1,
      urgency: 0,
      shortage: 0,
      vulnerability: 0,
    }
    const critical = priorityScore(input({ severity: 'critical' }), peopleOnly)
    const low = priorityScore(input({ severity: 'low' }), peopleOnly)
    expect(critical).toBe(low)
  })
})

describe('ordering', () => {
  it('ranks critical above low, all else equal', () => {
    expect(priorityScore(input({ severity: 'critical' }))).toBeGreaterThan(
      priorityScore(input({ severity: 'low' })),
    )
  })

  it('raises an ageing need', () => {
    expect(priorityScore(input({ ageMinutes: 240 }))).toBeGreaterThan(
      priorityScore(input({ ageMinutes: 0 })),
    )
  })

  it('caps the age ramp so waiting never outranks severity', () => {
    const oldLow = priorityScore(input({ severity: 'low', ageMinutes: 100_000 }))
    const freshCritical = priorityScore(input({ severity: 'critical', ageMinutes: 0 }))
    expect(freshCritical).toBeGreaterThan(oldLow)
  })

  it('scales people sublinearly — ten times more is not ten times worse', () => {
    const fifty = priorityScore(input({ peopleAffected: 50 }))
    const fiveHundred = priorityScore(input({ peopleAffected: 500 }))
    expect(fiveHundred).toBeGreaterThan(fifty)
    expect(fiveHundred).toBeLessThan(fifty * 2)
  })

  it('ranks a partly covered need below an untouched one', () => {
    expect(priorityScore(input({ shortageRatio: 1 }))).toBeGreaterThan(
      priorityScore(input({ shortageRatio: 0.2 })),
    )
  })

  it('lifts a need involving vulnerable people', () => {
    expect(priorityScore(input({ vulnerable: true }))).toBeGreaterThan(
      priorityScore(input({ vulnerable: false })),
    )
  })

  it('is deterministic', () => {
    const value = input({ severity: 'high', ageMinutes: 33, peopleAffected: 412 })
    expect(priorityScore(value)).toBe(priorityScore(value))
  })
})

describe('priorityLevel', () => {
  it('maps the score onto the four bands', () => {
    expect(priorityLevel(90)).toBe('critical')
    expect(priorityLevel(75)).toBe('critical')
    expect(priorityLevel(60)).toBe('high')
    expect(priorityLevel(40)).toBe('elevated')
    expect(priorityLevel(10)).toBe('routine')
  })
})
