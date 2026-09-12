import { describe, expect, it } from 'vitest'
import {
  categoryMacroF1,
  evidenceCompleteness,
  pairwiseClusteringF1,
  priorityNdcg,
} from './metrics.js'

/**
 * Every expected value here is worked out by hand in the comment beside it.
 * A metric test whose expectation came from running the metric proves only
 * that the code is consistent with itself.
 */

const m = (entries: [string, string][]) => new Map(entries)

describe('pairwise clustering F1', () => {
  it('is perfect when the partition matches, whatever the cluster is called', () => {
    /*
     * Cluster names are arbitrary, which is exactly why the metric scores
     * pairs. {a,b} and {c} under different names is still the same partition.
     */
    const truth = m([['a', 'T1'], ['b', 'T1'], ['c', 'T2']])
    const pred = m([['a', 'zzz'], ['b', 'zzz'], ['c', 'qqq']])
    expect(pairwiseClusteringF1(truth, pred).f1).toBe(1)
  })

  it('scores a merge as precision loss', () => {
    // Truth pairs: {a,b}. Predicted pairs: {a,b},{a,c},{b,c}.
    // tp=1, fp=2, fn=0 -> P = 1/3, R = 1, F1 = 2(1/3)/(4/3) = 0.5
    const truth = m([['a', 'T1'], ['b', 'T1'], ['c', 'T2']])
    const pred = m([['a', 'P1'], ['b', 'P1'], ['c', 'P1']])
    const s = pairwiseClusteringF1(truth, pred)
    expect(s.precision).toBeCloseTo(0.3333, 3)
    expect(s.recall).toBe(1)
    expect(s.f1).toBe(0.5)
  })

  it('scores a split as recall loss', () => {
    // Truth pairs: {a,b},{a,c},{b,c} = 3. Predicted: {a,b} = 1.
    // tp=1, fp=0, fn=2 -> P = 1, R = 1/3, F1 = 0.5
    const truth = m([['a', 'T1'], ['b', 'T1'], ['c', 'T1']])
    const pred = m([['a', 'P1'], ['b', 'P1'], ['c', 'P2']])
    const s = pairwiseClusteringF1(truth, pred)
    expect(s.precision).toBe(1)
    expect(s.recall).toBeCloseTo(0.3333, 3)
    expect(s.f1).toBe(0.5)
  })

  it('gives all-singletons a zero rather than a divide by zero', () => {
    const truth = m([['a', 'T1'], ['b', 'T1']])
    const pred = m([['a', 'P1'], ['b', 'P2']])
    expect(pairwiseClusteringF1(truth, pred).f1).toBe(0)
  })

  it('ignores items with no ground truth instead of counting them wrong', () => {
    /*
     * A prediction for an unlabelled item cannot be right or wrong. Scoring it
     * as an error would punish a system for the dataset's gaps.
     */
    const truth = m([['a', 'T1'], ['b', 'T1']])
    const pred = m([['a', 'P1'], ['b', 'P1'], ['unlabelled', 'P1']])
    expect(pairwiseClusteringF1(truth, pred).f1).toBe(1)
  })
})

describe('category macro F1', () => {
  it('is perfect when every prediction hits a true label', () => {
    const truth = new Map([['1', ['Request']], ['2', ['Report']]])
    const pred = m([['1', 'Request'], ['2', 'Report']])
    expect(categoryMacroF1(truth, pred).macroF1).toBe(1)
  })

  it('weights a rare label as heavily as a common one', () => {
    /*
     * The whole reason for macro averaging. Nine items right on the common
     * label and one wrong on the rare one is not 90% — the rare label scores
     * zero, and the macro average is (1 + 0) / 2.
     */
    const truth = new Map<string, string[]>()
    for (let i = 0; i < 9; i += 1) truth.set(`c${i}`, ['Common'])
    truth.set('r0', ['Rare'])

    const pred = new Map<string, string>()
    for (let i = 0; i < 9; i += 1) pred.set(`c${i}`, 'Common')
    pred.set('r0', 'Common') // the rare one missed

    const score = categoryMacroF1(truth, pred)
    const rare = score.perLabel.find((l) => l.label === 'Rare')!
    expect(rare.f1).toBe(0)
    expect(rare.support).toBe(1)
    // Common: tp=9, fp=1, fn=0 -> P=0.9, R=1, F1 = 2(0.9)/1.9 = 0.9474
    expect(score.macroF1).toBeCloseTo((0.9474 + 0) / 2, 3)
  })

  it('accepts any of an item\'s true labels', () => {
    // Multi-label truth, single-label prediction: naming any true label counts.
    const truth = new Map([['1', ['Request', 'Report']]])
    expect(categoryMacroF1(truth, m([['1', 'Report']])).perLabel.find((l) => l.label === 'Report')!.f1).toBe(1)
  })

  it('excludes labels with no support and no predictions', () => {
    /*
     * Otherwise a system could lift its macro score by staying silent about
     * categories the evaluation set never contained.
     */
    const truth = new Map([['1', ['A']]])
    const score = categoryMacroF1(truth, m([['1', 'A']]))
    expect(score.perLabel.map((l) => l.label)).toEqual(['A'])
  })

  it('does not know the taxonomy', () => {
    // Labels are opaque strings; nothing here enumerates an official set.
    const truth = new Map([['1', ['CompletelyMadeUpLabel']]])
    expect(categoryMacroF1(truth, m([['1', 'CompletelyMadeUpLabel']])).macroF1).toBe(1)
  })
})

describe('priority NDCG', () => {
  it('is 1 when the ranking is already ideal', () => {
    const ranked = [
      { id: 'a', score: 0.9 },
      { id: 'b', score: 0.5 },
      { id: 'c', score: 0.1 },
    ]
    const rel = new Map([['a', 3], ['b', 2], ['c', 1]])
    expect(priorityNdcg(ranked, rel).ndcg).toBe(1)
  })

  it('punishes burying the critical item', () => {
    const ranked = [
      { id: 'c', score: 0.9 },
      { id: 'b', score: 0.5 },
      { id: 'a', score: 0.1 },
    ]
    const rel = new Map([['a', 3], ['b', 2], ['c', 1]])
    const s = priorityNdcg(ranked, rel)
    // DCG = 1/1 + 3/1.585 + 7/2 = 1 + 1.8928 + 3.5 = 6.3928
    // Ideal = 7/1 + 3/1.585 + 1/2 = 7 + 1.8928 + 0.5 = 9.3928
    expect(s.ndcg).toBeCloseTo(6.3928 / 9.3928, 3)
    expect(s.ndcg).toBeLessThan(0.7)
  })

  it('uses exponential gain, so one critical outweighs several low', () => {
    /*
     * 2^3-1 = 7 against 2^1-1 = 1. Linear gain would treat three low items as
     * worth one critical, which is not how a response works.
     */
    const rel = new Map([['crit', 3], ['low1', 1], ['low2', 1], ['low3', 1]])
    const critFirst = priorityNdcg(
      [{ id: 'crit', score: 1 }, { id: 'low1', score: 0.9 }, { id: 'low2', score: 0.8 }, { id: 'low3', score: 0.7 }],
      rel,
    )
    const critLast = priorityNdcg(
      [{ id: 'low1', score: 1 }, { id: 'low2', score: 0.9 }, { id: 'low3', score: 0.8 }, { id: 'crit', score: 0.7 }],
      rel,
    )
    expect(critFirst.ndcg).toBe(1)
    expect(critLast.ndcg).toBeLessThan(0.8)
  })

  it('breaks score ties deterministically', () => {
    const ranked = [
      { id: 'b', score: 0.5 },
      { id: 'a', score: 0.5 },
    ]
    const rel = new Map([['a', 3], ['b', 0]])
    // Tie broken by id, so 'a' ranks first regardless of input order.
    expect(priorityNdcg(ranked, rel).ndcg).toBe(1)
    expect(priorityNdcg([...ranked].reverse(), rel).ndcg).toBe(1)
  })

  it('truncates at k', () => {
    const ranked = Array.from({ length: 10 }, (_, i) => ({ id: `i${i}`, score: 1 - i / 10 }))
    expect(priorityNdcg(ranked, new Map(), 3).depth).toBe(3)
  })

  it('is zero when nothing is relevant, not NaN', () => {
    const ranked = [{ id: 'a', score: 1 }]
    expect(priorityNdcg(ranked, new Map()).ndcg).toBe(0)
  })
})

describe('evidence completeness', () => {
  const known = new Set(['s1', 's2', 's3'])

  it('is 1 when every expected id is cited', () => {
    const score = evidenceCompleteness(
      [{ itemId: 's1', evidenceIds: ['s1', 's2'] }],
      new Map([['s1', ['s1', 's2']]]),
      known,
    )
    expect(score.completeness).toBe(1)
    expect(score.fabricated).toEqual([])
  })

  it('reports exactly which ids were missed', () => {
    const score = evidenceCompleteness(
      [{ itemId: 's1', evidenceIds: ['s1'] }],
      new Map([['s1', ['s1', 's2', 's3']]]),
      known,
    )
    expect(score.completeness).toBe(0)
    expect(score.missingBySample[0]!.missing).toEqual(['s2', 's3'])
  })

  it('flags a fabricated id separately from an incomplete one', () => {
    /*
     * Opposite failures. Missing evidence is an incomplete answer; a cited id
     * that exists nowhere is a claim about something that does not exist, and
     * completeness elsewhere does not excuse it.
     */
    const score = evidenceCompleteness(
      [{ itemId: 's1', evidenceIds: ['s1', 's2', 'INVENTED'] }],
      new Map([['s1', ['s1', 's2']]]),
      known,
    )
    expect(score.completeness).toBe(1)
    expect(score.fabricated).toEqual(['s1 -> INVENTED'])
  })

  it('flags predictions that cite nothing', () => {
    const score = evidenceCompleteness(
      [{ itemId: 's1', evidenceIds: [] }],
      new Map([['s1', ['s1']]]),
      known,
    )
    expect(score.empty).toEqual(['s1'])
    expect(score.completeness).toBe(0)
  })

  it('does not score predictions with no expectation', () => {
    const score = evidenceCompleteness(
      [{ itemId: 's3', evidenceIds: ['s3'] }],
      new Map(),
      known,
    )
    expect(score.completeness).toBe(0)
    expect(score.missingBySample).toEqual([])
  })
})
