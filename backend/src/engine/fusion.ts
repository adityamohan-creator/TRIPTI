/**
 * Grouping reports that describe the same underlying incident.
 *
 * Three people describing one flood write three different sentences. A
 * coordinator reading a feed has to work out that "water entering roads near
 * the railway station", "flooding at Jaipur station" and "flood worsening near
 * the station" are one event, not three — and doing that by hand is exactly
 * what stops scaling when a feed gets busy.
 *
 * Deterministic on purpose. Same reports in, same clusters out, every time, on
 * any machine — which means a cluster a coordinator questions can be explained
 * rather than reproduced approximately. `SimilarityProvider` is the seam where
 * an embedding model plugs in later without any of the rest moving.
 *
 * Pure: no I/O, no clock, no database. Everything it knows arrives as an
 * argument.
 */

export interface FusionReport {
  /**
   * The report's own id, carried through untouched into the cluster's
   * evidence. Never regenerated — see `evidence.ts`.
   */
  id: string
  text: string
  /** Epoch milliseconds, where known. */
  postedAt: number | null
  lat: number | null
  lon: number | null
}

export interface SimilarityScore {
  /** Overall similarity, 0-1. */
  score: number
  /** Each contribution, so a coordinator can see why two reports were joined. */
  lexical: number
  /** How many content words the two reports actually share. */
  sharedTokens: number
  geographic: number | null
  temporal: number | null
}

/**
 * Swappable scorer. The default is lexical and needs no model; an embedding
 * provider can implement this interface and be passed in without touching the
 * clustering itself.
 */
export interface SimilarityProvider {
  readonly name: string
  compare(a: FusionReport, b: FusionReport, options: FusionOptions): SimilarityScore
}

export interface FusionOptions {
  /** Above this, two reports are the same incident. */
  threshold: number
  /**
   * Text overlap below which no merge happens, whatever location and time say.
   *
   * Location and time *corroborate* a textual match; they do not substitute
   * for one. Without this floor, two reports sharing only the word "people",
   * four kilometres and twenty minutes apart, scored 0.384 and merged — a
   * flood at a railway station fused with a building collapse across town,
   * presented to a coordinator as one incident of six reports.
   *
   * Two separate emergencies in one city at one time is ordinary, not
   * exceptional, and proximity is exactly what they will always share.
   *
   * 0.2 sits in a wide measured gap: on the demo corpus, pairs describing the
   * same incident score 0.27-0.44 and pairs describing different ones score
   * 0.00-0.09.
   */
  minLexical: number
  /**
   * Content words two reports must share before they can merge, whatever the
   * ratios say.
   *
   * A ratio alone is not enough on short texts: "Station flooding, people
   * trapped" and "Building collapsed, people buried" share only "people", and
   * one word in four is 25% — comfortably past any sensible floor. Two
   * unrelated emergencies then merge because both involve people, which all of
   * them do.
   *
   * One shared word is never evidence of a common incident. Two is the
   * smallest claim worth making.
   */
  minSharedTokens: number
  /** Beyond this many kilometres, location argues against a match. */
  maxDistanceKm: number
  /** Beyond this many minutes, time argues against a match. */
  maxMinutesApart: number
  /** How much lexical overlap counts when location and time are also known. */
  lexicalWeight: number
  geoWeight: number
  timeWeight: number
}

export const DEFAULT_OPTIONS: FusionOptions = {
  /*
   * 0.34 from trying it on realistic reports. Crisis messages are short and
   * share little vocabulary even when they describe one event — "water entering
   * roads" and "flood worsening" overlap on almost nothing. A threshold tuned
   * for prose silently produces one cluster per report, which looks like a
   * working system returning nothing useful.
   */
  threshold: 0.34,
  minLexical: 0.2,
  minSharedTokens: 2,
  maxDistanceKm: 15,
  maxMinutesApart: 180,
  lexicalWeight: 0.6,
  geoWeight: 0.25,
  timeWeight: 0.15,
}

/*
 * Words carrying no signal about *which* incident a report describes. Kept
 * short and English-only on purpose: an aggressive list starts removing the
 * words that distinguish one event from another, and a reporting verb like
 * "flooding" is precisely the term two reports of the same flood share.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'has', 'have', 'had', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'from',
  'by', 'as', 'it', 'its', 'this', 'that', 'these', 'those', 'there', 'here',
  'we', 'i', 'they', 'he', 'she', 'you', 'my', 'our', 'their', 'his', 'her',
  'near', 'around', 'about', 'some', 'any', 'all', 'more', 'very', 'please',
  'update', 'reported', 'reports', 'report',
])

/** Lowercase, strip punctuation, drop stopwords and one-character tokens. */
export function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))

  return new Set(tokens)
}

/**
 * Jaccard overlap, but divided by the smaller set rather than the union.
 *
 * A two-word report and a thirty-word report about the same incident have a
 * tiny union, so true Jaccard scores them apart no matter how much they share.
 * Containment asks the question that actually matters here: is the shorter
 * report essentially contained in the longer one?
 */
export function sharedTokenCount(a: Set<string>, b: Set<string>): number {
  let shared = 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  for (const token of small) if (large.has(token)) shared += 1
  return shared
}

export function lexicalSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  return sharedTokenCount(a, b) / Math.min(a.size, b.size)
}

/** Great-circle distance in kilometres. */
export function distanceKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6371
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLon = ((bLon - aLon) * Math.PI) / 180
  const lat1 = (aLat * Math.PI) / 180
  const lat2 = (bLat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Lexical overlap, with location and time as corroboration where present.
 *
 * Missing signals are dropped and the remaining weights renormalised, never
 * treated as zero. A report with no coordinates is not evidence that it
 * happened somewhere else — most crisis reports carry no location at all, and
 * scoring absence as disagreement would leave almost nothing clustered.
 */
export const lexicalProvider: SimilarityProvider = {
  name: 'lexical-v1',

  compare(a, b, options) {
    const tokensA = tokenize(a.text)
    const tokensB = tokenize(b.text)
    const shared = sharedTokenCount(tokensA, tokensB)
    const lexical = lexicalSimilarity(tokensA, tokensB)

    let geographic: number | null = null
    if (a.lat != null && a.lon != null && b.lat != null && b.lon != null) {
      const km = distanceKm(a.lat, a.lon, b.lat, b.lon)
      geographic = Math.max(0, 1 - km / options.maxDistanceKm)
    }

    let temporal: number | null = null
    if (a.postedAt != null && b.postedAt != null) {
      const minutes = Math.abs(a.postedAt - b.postedAt) / 60_000
      temporal = Math.max(0, 1 - minutes / options.maxMinutesApart)
    }

    let weighted = lexical * options.lexicalWeight
    let total = options.lexicalWeight

    if (geographic !== null) {
      weighted += geographic * options.geoWeight
      total += options.geoWeight
    }
    if (temporal !== null) {
      weighted += temporal * options.timeWeight
      total += options.timeWeight
    }

    return {
      score: total === 0 ? 0 : weighted / total,
      lexical,
      sharedTokens: shared,
      geographic,
      temporal,
    }
  },
}

// ------------------------------------------------------------- clustering

export interface ClusterLink {
  a: string
  b: string
  similarity: SimilarityScore
}

export interface FusedCluster {
  /** Stable within one run: CL-001, CL-002 … in order of first member. */
  clusterId: string
  reportIds: string[]
  /** Why these were joined. Empty for a cluster of one. */
  links: ClusterLink[]
  /** Mean similarity across the links that formed it. Null for a singleton. */
  cohesion: number | null
}

/** Union-find, so clustering is order-independent and runs in near-linear time. */
class DisjointSet {
  private parent = new Map<string, string>()

  find(x: string): string {
    const p = this.parent.get(x)
    if (p === undefined) {
      this.parent.set(x, x)
      return x
    }
    if (p === x) return x
    const root = this.find(p)
    this.parent.set(x, root)
    return root
  }

  union(a: string, b: string) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

export interface FusionResult {
  clusters: FusedCluster[]
  /** Every pair compared, for anyone auditing why something did not merge. */
  comparisons: number
  provider: string
  options: FusionOptions
}

/**
 * Groups reports into clusters by single-linkage agglomeration.
 *
 * Single linkage — A joins B, B joins C, so all three are one cluster, even
 * where A and C share nothing directly. That is usually right here: a flood
 * described at the station, then two streets over, then by the bridge is one
 * flood, and each report overlaps its neighbour rather than the whole. The
 * known cost is chaining, where a long thread of weak links drags unrelated
 * reports together; `threshold` is the control, and `cohesion` is what exposes
 * it when it happens.
 */
export function fuseReports(
  reports: FusionReport[],
  options: Partial<FusionOptions> = {},
  provider: SimilarityProvider = lexicalProvider,
): FusionResult {
  const opts: FusionOptions = { ...DEFAULT_OPTIONS, ...options }
  const sets = new DisjointSet()
  const links: ClusterLink[] = []
  let comparisons = 0

  // Every pair once. Report counts here are hundreds, not millions.
  for (let i = 0; i < reports.length; i += 1) {
    const a = reports[i]!
    sets.find(a.id)

    for (let j = i + 1; j < reports.length; j += 1) {
      const b = reports[j]!
      comparisons += 1

      const similarity = provider.compare(a, b, opts)

      /*
       * Both gates. The floor is checked separately from the combined score so
       * nearness can never carry a pair that shares no words — see
       * `minLexical`.
       */
      if (
        similarity.sharedTokens >= opts.minSharedTokens &&
        similarity.lexical >= opts.minLexical &&
        similarity.score >= opts.threshold
      ) {
        sets.union(a.id, b.id)
        links.push({ a: a.id, b: b.id, similarity })
      }
    }
  }

  // Grouped in first-seen order, so cluster numbering follows the input and a
  // rerun on the same input produces the same labels.
  const members = new Map<string, string[]>()
  for (const report of reports) {
    const root = sets.find(report.id)
    const list = members.get(root)
    if (list) list.push(report.id)
    else members.set(root, [report.id])
  }

  const clusters: FusedCluster[] = []
  let n = 1

  for (const reportIds of members.values()) {
    const inside = new Set(reportIds)
    const own = links.filter((l) => inside.has(l.a) && inside.has(l.b))
    const cohesion =
      own.length === 0
        ? null
        : Math.round(
            (own.reduce((sum, l) => sum + l.similarity.score, 0) / own.length) * 1000,
          ) / 1000

    clusters.push({
      clusterId: `CL-${String(n).padStart(3, '0')}`,
      reportIds,
      links: own,
      cohesion,
    })
    n += 1
  }

  return { clusters, comparisons, provider: provider.name, options: opts }
}
