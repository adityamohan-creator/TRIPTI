import { describe, expect, it } from 'vitest'
import {
  type DeliveryRecord,
  median,
  summariseByKind,
  summariseImpact,
  summariseTimeline,
  summariseUtilisation,
} from './impact.js'

const REPORTED = '2026-09-09T08:00:00.000Z'

function delivery(over: Partial<DeliveryRecord> = {}): DeliveryRecord {
  return {
    missionId: 'm1',
    incidentId: 'i1',
    quantity: 100,
    unit: 'meals',
    kind: 'food',
    perishable: false,
    peopleAffected: 300,
    reportedAt: REPORTED,
    verifiedAt: '2026-09-09T10:00:00.000Z',
    ...over,
  }
}

describe('counting people', () => {
  it('counts an incident once, however many deliveries it received', () => {
    /*
     * The figure that ends up in a report. Summing per mission turns one flood
     * of 300 people into 900 helped, which is the easiest way to publish a
     * number that is three times too large.
     */
    const totals = summariseImpact([
      delivery({ missionId: 'm1' }),
      delivery({ missionId: 'm2' }),
      delivery({ missionId: 'm3' }),
    ])
    expect(totals.peopleHelped).toBe(300)
    expect(totals.missionsCompleted).toBe(3)
    expect(totals.incidentsServed).toBe(1)
  })

  it('adds up across separate incidents', () => {
    const totals = summariseImpact([
      delivery({ incidentId: 'i1', peopleAffected: 300 }),
      delivery({ incidentId: 'i2', peopleAffected: 50 }),
    ])
    expect(totals.peopleHelped).toBe(350)
    expect(totals.incidentsServed).toBe(2)
  })

  it('says how many incidents never reported a headcount', () => {
    // Reaching someone uncounted is not the same as reaching nobody, so the
    // total has to admit the gap rather than quietly read low.
    const totals = summariseImpact([
      delivery({ incidentId: 'i1', peopleAffected: 300 }),
      delivery({ incidentId: 'i2', peopleAffected: null }),
    ])
    expect(totals.peopleHelped).toBe(300)
    expect(totals.incidentsWithoutHeadcount).toBe(1)
  })
})

describe('counting what was delivered', () => {
  it('counts meals only where the unit means a meal', () => {
    const totals = summariseImpact([
      delivery({ quantity: 100, unit: 'meals' }),
      delivery({ missionId: 'm2', quantity: 40, unit: 'portions' }),
      delivery({ missionId: 'm3', quantity: 999, unit: 'crates' }),
    ])
    expect(totals.mealsDelivered).toBe(140)
  })

  it('counts water in litres, whatever the donor typed', () => {
    const totals = summariseImpact([
      delivery({ kind: 'water', quantity: 500, unit: 'Litres' }),
      delivery({ missionId: 'm2', kind: 'water', quantity: 250, unit: 'l' }),
    ])
    expect(totals.waterLitres).toBe(750)
  })

  it('counts only perishable food as rescued', () => {
    /*
     * Tinned goods from a warehouse fed people, but nothing was saved from
     * being thrown away. Counting them as rescue inflates the one number the
     * whole food-waste claim rests on.
     */
    const totals = summariseImpact([
      delivery({ kind: 'food', unit: 'kg', quantity: 80, perishable: true }),
      delivery({
        missionId: 'm2',
        kind: 'food',
        unit: 'kg',
        quantity: 500,
        perishable: false,
      }),
    ])
    expect(totals.foodKgRescued).toBe(80)
  })

  it('ignores an unmetered delivery rather than guessing at it', () => {
    const totals = summariseImpact([delivery({ quantity: null })])
    expect(totals.mealsDelivered).toBe(0)
    // It still reached someone, and that much is known.
    expect(totals.peopleHelped).toBe(300)
    expect(totals.missionsCompleted).toBe(1)
  })
})

describe('response time', () => {
  it('measures to the first delivery, not the last', () => {
    // A top-up two days later did not make the response slower.
    const totals = summariseImpact([
      delivery({ missionId: 'm1', verifiedAt: '2026-09-09T10:00:00.000Z' }),
      delivery({ missionId: 'm2', verifiedAt: '2026-09-11T10:00:00.000Z' }),
    ])
    expect(totals.medianResponseMinutes).toBe(120)
    expect(totals.slowestResponseMinutes).toBe(120)
  })

  it('reports a median, not a mean', () => {
    const totals = summariseImpact([
      delivery({ incidentId: 'i1', verifiedAt: '2026-09-09T09:00:00.000Z' }),
      delivery({ incidentId: 'i2', verifiedAt: '2026-09-09T10:00:00.000Z' }),
      // One delivery that sat unverified over a weekend.
      delivery({ incidentId: 'i3', verifiedAt: '2026-09-12T08:00:00.000Z' }),
    ])
    expect(totals.medianResponseMinutes).toBe(120)
    expect(totals.fastestResponseMinutes).toBe(60)
  })

  it('refuses a negative response time rather than reporting one', () => {
    // Clock skew, or a backdated verification. Either way it is not evidence
    // that the delivery arrived before the report.
    const totals = summariseImpact([delivery({ verifiedAt: '2026-09-09T07:00:00.000Z' })])
    expect(totals.medianResponseMinutes).toBeNull()
  })

  it('has no response time when nothing has been delivered', () => {
    const totals = summariseImpact([])
    expect(totals.medianResponseMinutes).toBeNull()
    expect(totals.fastestResponseMinutes).toBeNull()
    expect(totals.peopleHelped).toBe(0)
  })
})

describe('median', () => {
  it('averages the middle pair on an even count', () => {
    expect(median([10, 20, 30, 40])).toBe(25)
  })

  it('takes the middle of an odd count', () => {
    expect(median([30, 10, 20])).toBe(20)
  })

  it('is null for nothing', () => {
    expect(median([])).toBeNull()
  })

  it('does not reorder its input', () => {
    const values = [30, 10, 20]
    median(values)
    expect(values).toEqual([30, 10, 20])
  })
})

describe('the timeline', () => {
  const from = Date.parse('2026-09-09T00:00:00.000Z')
  const to = Date.parse('2026-09-12T00:00:00.000Z')

  it('includes days where nothing happened', () => {
    /*
     * Without the empty days a chart slopes smoothly between two distant
     * points, which reads as steady work through a week where nothing moved.
     */
    const days = summariseTimeline(
      [delivery({ verifiedAt: '2026-09-12T10:00:00.000Z' })],
      from,
      to,
    )
    expect(days).toHaveLength(4)
    expect(days.map((d) => d.deliveries)).toEqual([0, 0, 0, 1])
  })

  it('counts an incident on the day it was first reached', () => {
    const days = summariseTimeline(
      [
        delivery({ missionId: 'm1', verifiedAt: '2026-09-10T10:00:00.000Z' }),
        delivery({ missionId: 'm2', verifiedAt: '2026-09-11T10:00:00.000Z' }),
      ],
      from,
      to,
    )
    expect(days.map((d) => d.incidentsFirstServed)).toEqual([0, 1, 0, 0])
    expect(days.map((d) => d.deliveries)).toEqual([0, 1, 1, 0])
  })

  it('returns nothing for a backwards range instead of looping', () => {
    expect(summariseTimeline([delivery()], to, from)).toEqual([])
  })
})

describe('by kind', () => {
  it('totals a kind that arrived in one unit', () => {
    const [food] = summariseByKind([
      delivery({ kind: 'food', quantity: 100, unit: 'meals' }),
      delivery({ missionId: 'm2', kind: 'food', quantity: 50, unit: 'meals' }),
    ])
    expect(food).toMatchObject({ kind: 'food', deliveries: 2, quantity: 150, unit: 'meals' })
  })

  it('withholds a total when the units cannot be added', () => {
    // Six bottles and four litres of water is not "ten" of anything.
    const [water] = summariseByKind([
      delivery({ kind: 'water', quantity: 6, unit: 'bottles' }),
      delivery({ missionId: 'm2', kind: 'water', quantity: 4, unit: 'litres' }),
    ])
    expect(water!.quantity).toBeNull()
    expect(water!.deliveries).toBe(2)
  })

  it('withholds a total when part of the kind was unmetered', () => {
    const [rescue] = summariseByKind([
      delivery({ kind: 'rescue', quantity: 2, unit: 'teams' }),
      delivery({ missionId: 'm2', kind: 'rescue', quantity: null, unit: null }),
    ])
    expect(rescue!.quantity).toBeNull()
    expect(rescue!.deliveries).toBe(2)
  })

  it('puts the busiest kind first', () => {
    const kinds = summariseByKind([
      delivery({ kind: 'water' }),
      delivery({ missionId: 'm2', kind: 'food' }),
      delivery({ missionId: 'm3', kind: 'food' }),
    ])
    expect(kinds.map((k) => k.kind)).toEqual(['food', 'water'])
  })
})

describe('utilisation', () => {
  it('leaves unmetered resources out of the stock figure', () => {
    /*
     * A rescue team has no quantity to take a percentage of. Counting it as
     * fully committed or fully idle invents a number either way.
     */
    const result = summariseUtilisation({
      resources: [
        { quantity: 1000, reservedQuantity: 250 },
        { quantity: null, reservedQuantity: 0 },
      ],
      volunteers: [],
      vehicles: [],
    })
    expect(result.stockCommitted).toBe(0.25)
  })

  it('has no stock figure when nothing is measurable', () => {
    const result = summariseUtilisation({
      resources: [{ quantity: null, reservedQuantity: 0 }],
      volunteers: [],
      vehicles: [],
    })
    expect(result.stockCommitted).toBeNull()
  })

  it('counts who is actually available', () => {
    const result = summariseUtilisation({
      resources: [],
      volunteers: [
        { availability: 'available' },
        { availability: 'busy' },
        { availability: 'offline' },
      ],
      vehicles: [{ availability: 'available' }],
    })
    expect(result).toMatchObject({
      volunteersAvailable: 1,
      volunteersTotal: 3,
      vehiclesAvailable: 1,
      vehiclesTotal: 1,
    })
  })
})

describe('honesty', () => {
  it('is deterministic', () => {
    const input = [delivery(), delivery({ missionId: 'm2', incidentId: 'i2' })]
    expect(JSON.stringify(summariseImpact(input))).toBe(JSON.stringify(summariseImpact(input)))
  })

  it('writes nothing to its input', () => {
    const input = [delivery()]
    const before = JSON.stringify(input)
    summariseImpact(input)
    summariseByKind(input)
    expect(JSON.stringify(input)).toBe(before)
  })
})
