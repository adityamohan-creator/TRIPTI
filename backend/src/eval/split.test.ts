import { describe, expect, it } from 'vitest'
import { checkForLeaks, groupBySource, splitBySource } from './split.js'
import type { CrisisReport } from './types.js'
import { makeVariant } from './variants.js'

function report(over: Partial<CrisisReport> = {}): CrisisReport {
  return {
    id: 'm-1',
    eventId: 'event-35',
    text: 'Water needed at the community centre',
    postedAt: null,
    lat: null,
    lon: null,
    variantOf: null,
    ...over,
  }
}

/** A corpus of originals plus whichever variants the hash selected. */
function corpus(count: number, eventId = 'event-35'): CrisisReport[] {
  const originals = Array.from({ length: count }, (_, i) =>
    report({
      id: `${eventId}-m${i}`,
      eventId,
      text: `Report ${i} describing flooding and requesting drinking water urgently`,
    }),
  )

  const variants: CrisisReport[] = []
  for (const original of originals) {
    const v = makeVariant(original.id, original.text)
    if (v) {
      variants.push(
        report({ id: v.variantId, eventId, text: v.text, variantOf: v.sourceId }),
      )
    }
  }

  return [...originals, ...variants]
}

describe('grouping', () => {
  it('puts a variant with the message it came from', () => {
    const groups = groupBySource([
      report({ id: 'a' }),
      report({ id: 'a::v1', variantOf: 'a' }),
      report({ id: 'b' }),
    ])
    expect(groups).toHaveLength(2)
    expect(groups.find((g) => g.sourceId === 'a')!.members).toHaveLength(2)
  })

  it('treats an orphaned variant as belonging to its absent source', () => {
    /*
     * The original not being in this corpus is not licence to treat the
     * variant as an independent report — it is still the same underlying
     * message, and could still meet its source in another split.
     */
    const groups = groupBySource([report({ id: 'x::v1', variantOf: 'x' })])
    expect(groups[0]!.sourceId).toBe('x')
  })

  it('is stable regardless of input order', () => {
    const reports = [report({ id: 'c' }), report({ id: 'a' }), report({ id: 'b' })]
    const forward = groupBySource(reports).map((g) => g.sourceId)
    const backward = groupBySource([...reports].reverse()).map((g) => g.sourceId)
    expect(forward).toEqual(backward)
  })
})

describe('the invariant that matters', () => {
  it('never separates a variant from its source', () => {
    /*
     * The whole reason this file exists. A variant is a near-duplicate by
     * construction; seeing the original in training and being asked about the
     * variant at evaluation is asking a system to recognise a string it has
     * already memorised. Scores rise, nothing generalises.
     */
    const split = splitBySource(corpus(200))
    expect(checkForLeaks(split).leaked).toBe(false)
  })

  it('holds across many salts', () => {
    for (const salt of ['a', 'b', 'c', 'ai03', 'run-7']) {
      const split = splitBySource(corpus(120), { salt })
      const leaks = checkForLeaks(split)
      expect(leaks.offendingSources).toEqual([])
    }
  })

  it('holds across several events', () => {
    const reports = [
      ...corpus(60, 'event-35'),
      ...corpus(60, 'event-42'),
      ...corpus(60, 'event-49'),
    ]
    expect(checkForLeaks(splitBySource(reports)).leaked).toBe(false)
  })

  it('detects a leak when one is manufactured', () => {
    // The checker must be capable of failing, or it proves nothing above.
    const leaked = {
      train: [report({ id: 'a' })],
      evaluation: [report({ id: 'a::v1', variantOf: 'a' })],
    }
    const result = checkForLeaks(leaked)
    expect(result.leaked).toBe(true)
    expect(result.offendingSources).toEqual(['a'])
  })
})

describe('the split itself', () => {
  it('puts every record on exactly one side', () => {
    const reports = corpus(100)
    const split = splitBySource(reports)
    expect(split.train.length + split.evaluation.length).toBe(reports.length)

    const ids = new Set([...split.train, ...split.evaluation].map((r) => r.id))
    expect(ids.size).toBe(reports.length)
  })

  it('is deterministic', () => {
    const reports = corpus(80)
    const a = splitBySource(reports)
    const b = splitBySource(reports)
    expect(a.evaluation.map((r) => r.id)).toEqual(b.evaluation.map((r) => r.id))
  })

  it('does not reshuffle everything when one message is added', () => {
    /*
     * Hash-based rather than index-based. An index split silently invalidates
     * comparison with every earlier run the moment the corpus changes.
     */
    const base = corpus(100)
    const before = new Set(splitBySource(base).evaluation.map((r) => r.id))

    const grown = [...base, report({ id: 'event-35-mNEW', eventId: 'event-35' })]
    const after = new Set(splitBySource(grown).evaluation.map((r) => r.id))

    const moved = [...before].filter((id) => !after.has(id)).length
    expect(moved).toBeLessThan(before.size * 0.15)
  })

  it('gives every event a share of the evaluation set', () => {
    /*
     * Without stratification a small event can land entirely in training, and
     * an event that contributes nothing to evaluation contributes nothing to
     * the score.
     */
    const reports = [
      ...corpus(40, 'event-35'),
      ...corpus(8, 'event-42'),
      ...corpus(40, 'event-49'),
    ]
    const split = splitBySource(reports, { stratifyByEvent: true })
    const events = new Set(split.evaluation.map((r) => r.eventId))
    expect(events).toContain('event-35')
    expect(events).toContain('event-42')
    expect(events).toContain('event-49')
  })

  it('respects the requested ratio, roughly', () => {
    const reports = corpus(300)
    const split = splitBySource(reports, { evaluationRatio: 0.25 })
    const share = split.evaluation.length / reports.length
    expect(share).toBeGreaterThan(0.15)
    expect(share).toBeLessThan(0.38)
  })

  it('handles a corpus with no variants at all', () => {
    const reports = Array.from({ length: 20 }, (_, i) => report({ id: `plain-${i}` }))
    const split = splitBySource(reports)
    expect(split.train.length + split.evaluation.length).toBe(20)
    expect(checkForLeaks(split).leaked).toBe(false)
  })
})
