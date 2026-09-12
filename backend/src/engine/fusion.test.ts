import { describe, expect, it } from 'vitest'
import {
  DEFAULT_OPTIONS,
  type FusionReport,
  fuseReports,
  lexicalSimilarity,
  tokenize,
} from './fusion.js'
import { DEMO_REPORTS } from '../ai/demoReports.js'

function report(id: string, text: string, over: Partial<FusionReport> = {}): FusionReport {
  return { id, text, postedAt: null, lat: null, lon: null, ...over }
}

/** Which cluster each report landed in, for asserting on groupings. */
function clusterOf(result: ReturnType<typeof fuseReports>): Map<string, string> {
  const map = new Map<string, string>()
  for (const cluster of result.clusters) {
    for (const id of cluster.reportIds) map.set(id, cluster.clusterId)
  }
  return map
}

describe('tokenizing', () => {
  it('drops punctuation and case', () => {
    expect([...tokenize('Flooding, NEAR the station!')]).toEqual(['flooding', 'station'])
  })

  it('keeps the words that identify an incident', () => {
    // "flooding" and "jaipur" are exactly what two reports of one event share.
    const tokens = tokenize('Heavy flooding reported near Jaipur railway station')
    expect(tokens.has('flooding')).toBe(true)
    expect(tokens.has('jaipur')).toBe(true)
    expect(tokens.has('railway')).toBe(true)
  })

  it('drops reporting boilerplate that carries no signal', () => {
    const tokens = tokenize('Update: reported near the area')
    expect(tokens.has('update')).toBe(false)
    expect(tokens.has('reported')).toBe(false)
  })

  it('handles non-Latin script without emptying it', () => {
    expect(tokenize('सेक्टर 62 में पानी भर गया').size).toBeGreaterThan(2)
  })
})

describe('lexical similarity', () => {
  it('is 1 for identical token sets', () => {
    expect(lexicalSimilarity(tokenize('flood at station'), tokenize('flood at station'))).toBe(1)
  })

  it('is 0 when nothing is shared', () => {
    expect(lexicalSimilarity(tokenize('fire downtown'), tokenize('water depot'))).toBe(0)
  })

  it('does not punish a short report for being short', () => {
    /*
     * The reason this is containment rather than true Jaccard. A three-word
     * report and a twenty-word report about one incident have a large union,
     * so Jaccard scores them apart however much they share.
     */
    const short = tokenize('flooding station')
    const long = tokenize(
      'Heavy flooding reported near the railway station with water entering shops and homes on both sides',
    )
    expect(lexicalSimilarity(short, long)).toBe(1)
  })

  it('is symmetric', () => {
    const a = tokenize('flood near station')
    const b = tokenize('station flooding water')
    expect(lexicalSimilarity(a, b)).toBe(lexicalSimilarity(b, a))
  })
})

describe('similar reports are clustered', () => {
  it('groups three descriptions of one flood', () => {
    // The worked example from the brief.
    const result = fuseReports([
      report('REPORT-102', 'Heavy flooding reported near Jaipur railway station'),
      report('REPORT-109', 'Water has entered roads around Jaipur railway station'),
      report('REPORT-115', 'Flood situation worsening near Jaipur railway station'),
    ])

    expect(result.clusters).toHaveLength(1)
    expect(result.clusters[0]!.reportIds).toHaveLength(3)
    expect(result.clusters[0]!.cohesion).toBeGreaterThan(0.3)
  })

  it('records why each pair was joined', () => {
    const result = fuseReports([
      report('a', 'Flooding near Jaipur railway station'),
      report('b', 'Flood water at Jaipur railway station'),
    ])
    const link = result.clusters[0]!.links[0]!
    expect(link.similarity.lexical).toBeGreaterThan(0)
    expect(link.similarity.score).toBeGreaterThanOrEqual(DEFAULT_OPTIONS.threshold)
  })

  it('chains through a middle report', () => {
    /*
     * Single linkage, and usually right: a flood described at the station,
     * then two streets over, then at the bridge is one flood. Each report
     * overlaps its neighbour rather than the whole.
     */
    const result = fuseReports([
      report('a', 'Flooding at Jaipur railway station platform'),
      report('b', 'Jaipur railway station flooding, water reaching the bridge road'),
      report('c', 'Bridge road under water, cars stuck'),
    ])
    expect(result.clusters).toHaveLength(1)
  })
})

describe('unrelated reports stay apart', () => {
  it('separates a flood from a fire in another city', () => {
    const result = fuseReports([
      report('a', 'Heavy flooding near Jaipur railway station'),
      report('b', 'Factory fire in Ludhiana industrial area, smoke visible'),
    ])
    expect(result.clusters).toHaveLength(2)
  })

  it('keeps three distinct incidents distinct', () => {
    const result = fuseReports([
      report('a', 'Flooding near Jaipur railway station'),
      report('b', 'Building collapse in Pune, people trapped under rubble'),
      report('c', 'Medical supplies running out at Chennai relief camp'),
    ])
    expect(result.clusters).toHaveLength(3)
    for (const cluster of result.clusters) {
      expect(cluster.cohesion).toBeNull()
      expect(cluster.links).toEqual([])
    }
  })

  it('does not merge on shared crisis vocabulary alone', () => {
    /*
     * Both mention water and people. Without this, every water-related report
     * in a feed collapses into one cluster.
     */
    const result = fuseReports([
      report('a', 'Drinking water shortage for people at Chennai camp'),
      report('b', 'Flood water trapping people in Guwahati basements'),
    ])
    expect(result.clusters).toHaveLength(2)
  })
})

describe('location and time as corroboration', () => {
  const JAIPUR = { lat: 26.9124, lon: 75.7873 }
  const MUMBAI = { lat: 19.076, lon: 72.8777 }

  it('lets nearby coordinates support a weaker text match', () => {
    const near = fuseReports([
      report('a', 'Water rising fast on the main road', { ...JAIPUR, postedAt: 1000 }),
      report('b', 'Road flooded, water rising', { ...JAIPUR, postedAt: 1000 }),
    ])
    expect(near.clusters).toHaveLength(1)
  })

  it('lets distance argue against a text match', () => {
    const far = fuseReports([
      report('a', 'Water rising fast on the main road', { ...JAIPUR, postedAt: 1000 }),
      report('b', 'Water rising fast on the main road', { ...MUMBAI, postedAt: 1000 }),
    ])
    // Identical text, 1100km apart: the text still carries it, but the score drops.
    const score = far.clusters[0]?.links[0]?.similarity
    if (score) expect(score.geographic).toBe(0)
  })

  it('treats a missing location as unknown, not as disagreement', () => {
    /*
     * Most crisis reports carry no coordinates. Scoring absence as
     * disagreement would leave almost nothing clustered.
     */
    const withCoords = fuseReports([
      report('a', 'Flooding near Jaipur railway station', JAIPUR),
      report('b', 'Flood water at Jaipur railway station', JAIPUR),
    ])
    const without = fuseReports([
      report('a', 'Flooding near Jaipur railway station'),
      report('b', 'Flood water at Jaipur railway station'),
    ])
    expect(withCoords.clusters).toHaveLength(1)
    expect(without.clusters).toHaveLength(1)
  })

  it('reports null for signals it did not have', () => {
    const result = fuseReports([
      report('a', 'Flooding near Jaipur railway station'),
      report('b', 'Flood water at Jaipur railway station'),
    ])
    const s = result.clusters[0]!.links[0]!.similarity
    expect(s.geographic).toBeNull()
    expect(s.temporal).toBeNull()
  })
})

describe('determinism and shape', () => {
  const corpus = [
    report('r1', 'Heavy flooding near Jaipur railway station'),
    report('r2', 'Water entering roads around Jaipur railway station'),
    report('r3', 'Factory fire in Ludhiana, smoke everywhere'),
    report('r4', 'Flood situation worsening near Jaipur station'),
  ]

  it('produces the same clusters every run', () => {
    expect(JSON.stringify(fuseReports(corpus))).toBe(JSON.stringify(fuseReports(corpus)))
  })

  it('groups the same reports whatever order they arrive in', () => {
    const forward = clusterOf(fuseReports(corpus))
    const backward = clusterOf(fuseReports([...corpus].reverse()))
    // Labels may differ with order; membership must not.
    expect(forward.get('r1')).toBe(forward.get('r2'))
    expect(backward.get('r1')).toBe(backward.get('r2'))
    expect(backward.get('r1')).not.toBe(backward.get('r3'))
  })

  it('puts every report in exactly one cluster', () => {
    const result = fuseReports(corpus)
    const all = result.clusters.flatMap((c) => c.reportIds)
    expect(all).toHaveLength(corpus.length)
    expect(new Set(all).size).toBe(corpus.length)
  })

  it('handles an empty corpus', () => {
    const result = fuseReports([])
    expect(result.clusters).toEqual([])
    expect(result.comparisons).toBe(0)
  })

  it('handles a single report', () => {
    const result = fuseReports([report('only', 'Flooding somewhere')])
    expect(result.clusters).toHaveLength(1)
    expect(result.clusters[0]!.cohesion).toBeNull()
  })

  it('writes nothing to its input', () => {
    const before = JSON.stringify(corpus)
    fuseReports(corpus)
    expect(JSON.stringify(corpus)).toBe(before)
  })

  it('lets the threshold be tightened', () => {
    const strict = fuseReports(corpus, { threshold: 0.99 })
    expect(strict.clusters).toHaveLength(4)
  })

  it('names the provider that produced the result', () => {
    expect(fuseReports(corpus).provider).toBe('lexical-v1')
  })
})

describe('nearness cannot merge reports that share no words', () => {
  /*
   * The false merge this floor exists to stop. A flood at a railway station
   * and a building collapse four kilometres away, twenty minutes apart, share
   * only the word "people" — and were being presented to a coordinator as one
   * incident of six reports.
   */
  const STATION = { lat: 26.9196, lon: 75.7878 }
  const WALLED = { lat: 26.9239, lon: 75.8267 }

  it('keeps two nearby, simultaneous, unrelated incidents apart', () => {
    const result = fuseReports([
      report('flood', 'Jaipur railway station flooding is rising, people trapped on the upper concourse', {
        ...STATION,
        postedAt: 1_000_000,
      }),
      report('collapse', 'Old building collapsed in the walled city area, casualties reported, people buried under rubble', {
        ...WALLED,
        postedAt: 1_001_000,
      }),
    ])
    expect(result.clusters).toHaveLength(2)
  })

  it('still merges when the text genuinely agrees', () => {
    const result = fuseReports([
      report('a', 'Old building collapsed in the walled city area, people buried', {
        ...WALLED,
        postedAt: 1_000_000,
      }),
      report('b', 'Building collapse in walled city, rescue teams digging', {
        ...WALLED,
        postedAt: 1_001_000,
      }),
    ])
    expect(result.clusters).toHaveLength(1)
  })

  it('is the floor, not the threshold, that stops it', () => {
    // Lower the combined threshold to nothing; the floor must still hold.
    const result = fuseReports(
      [
        report('flood', 'Station flooding, people trapped', { ...STATION, postedAt: 1_000_000 }),
        report('collapse', 'Building collapsed, people buried', { ...WALLED, postedAt: 1_000_500 }),
      ],
      { threshold: 0.05 },
    )
    expect(result.clusters).toHaveLength(2)
  })
})

describe('the demo corpus, end to end', () => {
  /*
   * A regression guard for the false merge found by running this for real.
   *
   * The flood at Jaipur station and the building collapse in the walled city
   * are 3.9km and 20 minutes apart and share exactly one content word. They
   * were being fused into a single six-report cluster, and the check that was
   * supposed to catch it only asserted what *should* be together — never what
   * must not be. Both halves are asserted here.
   */
  const reports: FusionReport[] = DEMO_REPORTS.map((r) => ({
    id: r.sourceId,
    text: r.text,
    postedAt: Date.parse(r.postedAt),
    lat: r.lat,
    lon: r.lon,
  }))

  const result = fuseReports(reports)
  const where = clusterOf(result)

  it('fuses the four Jaipur station flood reports', () => {
    const target = where.get('REPORT-102')
    for (const id of ['REPORT-109', 'REPORT-115', 'REPORT-121']) {
      expect(where.get(id)).toBe(target)
    }
  })

  it('fuses the two walled city collapse reports', () => {
    expect(where.get('REPORT-131')).toBe(where.get('REPORT-134'))
  })

  it('keeps those two incidents apart despite being 4km and 20 minutes apart', () => {
    expect(where.get('REPORT-102')).not.toBe(where.get('REPORT-131'))
  })

  it('fuses the Chennai water shortage reports', () => {
    expect(where.get('REPORT-140')).toBe(where.get('REPORT-147'))
  })

  it('leaves the uncorroborated reports on their own', () => {
    for (const id of ['REPORT-152', 'REPORT-158', 'REPORT-163', 'REPORT-171']) {
      const cluster = result.clusters.find((c) => c.reportIds.includes(id))!
      expect(cluster.reportIds).toHaveLength(1)
    }
  })

  it('produces seven clusters from twelve reports', () => {
    expect(reports).toHaveLength(12)
    expect(result.clusters).toHaveLength(7)
  })
})
