import { describe, expect, it } from 'vitest'
import { type Need, type Resource, matchNeeds } from './match.js'

const AT = { lat: 28.6, lon: 77.2 }
const NOW = Date.parse('2026-09-09T12:00:00Z')

const need = (id: string, quantity: number | null): Need => ({
  id,
  incidentId: 'i1',
  kind: 'food',
  quantity,
  at: AT,
  severity: 'high',
  peopleAffected: 100,
  ageMinutes: 0,
  lifeCritical: false,
  unmet: true,
})

const resource = (id: string, quantity: number | null): Resource => ({
  id,
  kind: 'food',
  quantity,
  reservedQuantity: 0,
  at: AT,
  expiryTime: null,
  perishable: false,
})

describe('over-commitment through the unmetered path', () => {
  it('does not promise one metered resource to two unmetered needs', () => {
    // The keyword fallback never states an amount, so a board of unmetered
    // needs is the common case rather than the exception. If an unknown
    // quantity consumes nothing, the same 400 meals get promised to every
    // need of that kind and two volunteers are sent to collect one load.
    const { matches } = matchNeeds(
      [need('a', null), need('b', null)],
      [resource('r1', 400)],
      { now: NOW },
    )

    const usingR1 = matches.filter((m) => m.resourceId === 'r1')
    expect(usingR1).toHaveLength(1)
  })

  it('does not send one rescue team to two places at once', () => {
    const { matches, unmatched } = matchNeeds(
      [need('a', null), need('b', null)],
      [resource('team', null)],
      { now: NOW },
    )

    expect(matches).toHaveLength(1)
    expect(unmatched).toHaveLength(1)
  })

  it('does not let an unknown demand starve a known one', () => {
    // The overcorrection: treating "amount unknown" as "takes everything"
    // meant a 600-litre need was told no water was available while 12,000
    // litres sat in the depot. One unmetered claim per resource is enough to
    // stop two volunteers collecting one load; it must not block a measured
    // need the same stock can plainly cover.
    const { matches, unmatched } = matchNeeds(
      [need('unknown', null), need('measured', 600)],
      [resource('depot', 12_000)],
      { now: NOW },
    )

    expect(matches.map((m) => m.needId).sort()).toEqual(['measured', 'unknown'])
    expect(unmatched).toEqual([])
  })

  it('still serves the second need when a second resource exists', () => {
    const { matches } = matchNeeds(
      [need('a', null), need('b', null)],
      [resource('r1', 400), resource('r2', 400)],
      { now: NOW },
    )

    expect(matches).toHaveLength(2)
    expect(new Set(matches.map((m) => m.resourceId)).size).toBe(2)
  })
})
