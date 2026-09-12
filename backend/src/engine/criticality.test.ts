import { describe, expect, it } from 'vitest'
import { type CriticalityInput, criticalityLevel, scoreCriticality } from './criticality.js'

function input(over: Partial<CriticalityInput> = {}): CriticalityInput {
  return {
    texts: ['Water entering roads near the station'],
    informationType: 'flooding',
    reportCount: 1,
    peopleAffected: null,
    classificationConfidence: 0.5,
    ...over,
  }
}

describe('the score stays in range', () => {
  it('is always between 0 and 100', () => {
    const extreme = scoreCriticality(
      input({
        texts: [
          'SOS urgent immediately trapped drowning casualties dead bodies injured bleeding unconscious collapse buried children elderly disabled pregnant hospital no oxygen worsening rising spreading swept away stranded',
        ],
        informationType: 'rescue_request',
        reportCount: 500,
        peopleAffected: 10_000_000,
        classificationConfidence: 1,
      }),
    )
    expect(extreme.score).toBeLessThanOrEqual(100)
    expect(extreme.score).toBeGreaterThanOrEqual(0)
  })

  it('never goes below zero on an empty report', () => {
    const quiet = scoreCriticality(
      input({ texts: [''], informationType: 'other', classificationConfidence: 0 }),
    )
    expect(quiet.score).toBeGreaterThanOrEqual(0)
  })

  it('maps score to level at the documented boundaries', () => {
    expect(criticalityLevel(85)).toBe('critical')
    expect(criticalityLevel(84)).toBe('high')
    expect(criticalityLevel(65)).toBe('high')
    expect(criticalityLevel(64)).toBe('medium')
    expect(criticalityLevel(40)).toBe('medium')
    expect(criticalityLevel(39)).toBe('low')
  })
})

describe('what raises the score', () => {
  it('rates a rescue request above a resource offer', () => {
    const rescue = scoreCriticality(input({ informationType: 'rescue_request' }))
    const offer = scoreCriticality(input({ informationType: 'resource_availability' }))
    expect(rescue.score).toBeGreaterThan(offer.score)
  })

  it('raises the score when people are trapped', () => {
    const plain = scoreCriticality(input({ texts: ['Water on the road'] }))
    const trapped = scoreCriticality(input({ texts: ['Water on the road, people trapped'] }))
    expect(trapped.score).toBeGreaterThan(plain.score)
  })

  it('raises the score for casualties', () => {
    const base = scoreCriticality(input())
    const casualties = scoreCriticality(
      input({ texts: ['Building collapsed, casualties reported'] }),
    )
    expect(casualties.score).toBeGreaterThan(base.score)
  })

  it('rewards corroboration with diminishing returns', () => {
    /*
     * Two reports of one thing is meaningfully stronger than one. The
     * twentieth is not meaningfully stronger than the nineteenth, or a busy
     * hashtag would outrank a real emergency.
     */
    const one = scoreCriticality(input({ reportCount: 1 })).score
    const two = scoreCriticality(input({ reportCount: 2 })).score
    const twenty = scoreCriticality(input({ reportCount: 20 })).score
    const forty = scoreCriticality(input({ reportCount: 40 })).score

    expect(two).toBeGreaterThan(one)
    expect(twenty).toBeGreaterThan(two)
    expect(forty - twenty).toBeLessThan(two - one + 3)
  })

  it('scales headcount logarithmically', () => {
    const ten = scoreCriticality(input({ peopleAffected: 10 })).score
    const tenThousand = scoreCriticality(input({ peopleAffected: 10_000 })).score
    // Ten thousand matters more than ten, but not a thousand times more.
    expect(tenThousand).toBeGreaterThan(ten)
    expect(tenThousand - ten).toBeLessThan(20)
  })

  it('does not punish a report the classifier found hard to read', () => {
    /*
     * Low confidence adds nothing but subtracts nothing. Docking it would push
     * exactly the panicked, badly-written reports down the queue — the ones
     * most likely to be real.
     *
     * Tested as a comparison rather than against an absolute floor: the point
     * is that confidence cannot drag a score down, and the two inputs here
     * differ in nothing else.
     */
    const texts = ['people trapped help']
    const unsure = scoreCriticality(input({ texts, classificationConfidence: 0 }))
    const certain = scoreCriticality(input({ texts, classificationConfidence: 1 }))

    expect(unsure.score).toBeLessThanOrEqual(certain.score)
    // And the gap is small: confidence nudges, it does not decide.
    expect(certain.score - unsure.score).toBeLessThanOrEqual(6)
    // The danger language still carries it on its own.
    expect(unsure.factors.find((f) => f.key === 'danger')!.points).toBeGreaterThan(0)
  })
})

describe('the ceiling on danger language', () => {
  it('stops a long chatty cluster from outscoring a terse fatal one', () => {
    const chatty = scoreCriticality(
      input({
        texts: Array.from({ length: 30 }, () => 'urgent rising worsening spreading please'),
        informationType: 'flooding',
        reportCount: 30,
      }),
    )
    const terse = scoreCriticality(
      input({
        texts: ['Two dead, three trapped under the collapsed roof'],
        informationType: 'casualty_or_injury',
        reportCount: 1,
      }),
    )
    expect(terse.score).toBeGreaterThan(chatty.score)
  })

  it('counts a repeated phrase once', () => {
    const once = scoreCriticality(input({ texts: ['people trapped'] })).score
    const thrice = scoreCriticality(
      input({ texts: ['people trapped', 'people trapped', 'people trapped'] }),
    ).score
    // reportCount is unchanged here, so only corroboration could differ — it does not.
    expect(thrice).toBe(once)
  })
})

describe('explainability', () => {
  it('lists the factors that produced the score', () => {
    const result = scoreCriticality(
      input({
        texts: ['Children trapped in flooded building, urgent rescue needed'],
        informationType: 'rescue_request',
        reportCount: 3,
        peopleAffected: 40,
      }),
    )
    const keys = result.factors.map((f) => f.key)
    expect(keys).toContain('category')
    expect(keys).toContain('danger')
    expect(keys).toContain('scale')
    expect(keys).toContain('corroboration')
  })

  it('adds up to the score', () => {
    const result = scoreCriticality(input({ texts: ['people trapped'], reportCount: 4 }))
    const sum = result.factors.reduce((s, f) => s + f.points, 0)
    expect(Math.min(100, sum)).toBe(result.score)
  })

  it('writes a reason naming what actually fired', () => {
    const result = scoreCriticality(
      input({
        texts: ['Flooding worsening, people trapped on rooftops'],
        informationType: 'rescue_request',
        reportCount: 3,
        peopleAffected: 200,
      }),
    )
    expect(result.reason).toContain('3 corroborating reports')
    expect(result.reason).toContain('rescue request')
    expect(result.reason).toContain('people trapped')
    expect(result.reason).toContain('200')
  })

  it('does not claim corroboration for a single report', () => {
    expect(scoreCriticality(input({ reportCount: 1 })).reason).toContain('A single report')
  })

  it('closes with what to do about it', () => {
    const critical = scoreCriticality(
      input({
        texts: ['Dead and injured, children trapped, building collapsed, urgent'],
        informationType: 'casualty_or_injury',
        reportCount: 6,
        peopleAffected: 3000,
      }),
    )
    expect(critical.level).toBe('critical')
    expect(critical.reason).toContain('Needs a response now')
  })
})

describe('it is a pure function', () => {
  it('gives the same answer every time', () => {
    const i = input({ texts: ['people trapped, water rising'], reportCount: 3 })
    expect(JSON.stringify(scoreCriticality(i))).toBe(JSON.stringify(scoreCriticality(i)))
  })

  it('writes nothing to its input', () => {
    const i = input({ texts: ['people trapped'] })
    const before = JSON.stringify(i)
    scoreCriticality(i)
    expect(JSON.stringify(i)).toBe(before)
  })
})
