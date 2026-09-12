import { createHash } from 'node:crypto'
import type { CrisisReport, Split } from './types.js'

/**
 * Train/evaluation splitting at source level.
 *
 * The one rule this file exists to enforce: **a variant and the message it came
 * from are the same report, and must never land on opposite sides.**
 *
 * Get that wrong and the evaluation is worthless in a way that looks like
 * success. A variant is a near-duplicate by construction — lowercased, or with
 * "Update:" bolted on. A system that saw the original in training and is asked
 * about the variant at evaluation time is being asked to recognise a string it
 * has already memorised. Clustering F1 goes up, category F1 goes up, and none
 * of it transfers to a report the system has never seen.
 *
 * So the unit of splitting is the *source* id, never the record id.
 */

/** Every record derived from one underlying message. */
export interface SourceGroup {
  sourceId: string
  eventId: string
  members: CrisisReport[]
}

/**
 * Groups records by the message they ultimately came from.
 *
 * A record with no `variantOf` is its own source. A variant belongs to the
 * message it names, whether or not that message is present in this corpus —
 * an absent original is not licence to treat the variant as independent.
 */
export function groupBySource(reports: CrisisReport[]): SourceGroup[] {
  const groups = new Map<string, SourceGroup>()

  for (const report of reports) {
    const sourceId = report.variantOf ?? report.id
    const existing = groups.get(sourceId)
    if (existing) existing.members.push(report)
    else groups.set(sourceId, { sourceId, eventId: report.eventId, members: [report] })
  }

  // Sorted so the split is stable regardless of input order.
  return [...groups.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId))
}

/**
 * A stable number in [0,1) for a source id.
 *
 * Hash-based rather than index-based so adding one message to the corpus does
 * not reshuffle every other message's side. An index-based split silently
 * invalidates comparisons against every earlier run.
 */
function bucket(sourceId: string, salt: string): number {
  const digest = createHash('sha256').update(`${salt}:${sourceId}`).digest()
  // First four bytes as an unsigned integer, scaled into [0,1).
  return digest.readUInt32BE(0) / 2 ** 32
}

export interface SplitOptions {
  /** Share of sources placed in evaluation. Default 0.3. */
  evaluationRatio?: number
  /** Changes the assignment without changing the method. */
  salt?: string
  /**
   * Split within each event rather than across the corpus.
   *
   * On by default. TREC-IS events differ enormously in size and vocabulary, and
   * a corpus-wide split can hand one event entirely to evaluation — which
   * measures generalisation to an unseen disaster, not the task being scored.
   */
  stratifyByEvent?: boolean
}

/**
 * Splits sources, then expands to records.
 *
 * Deterministic: the same corpus and salt always produce the same split, so two
 * runs are comparable and a result can be reproduced months later.
 */
export function splitBySource(
  reports: CrisisReport[],
  options: SplitOptions = {},
): Split {
  const ratio = options.evaluationRatio ?? 0.3
  const salt = options.salt ?? 'ai03'
  const stratify = options.stratifyByEvent ?? true

  const groups = groupBySource(reports)

  const train: CrisisReport[] = []
  const evaluation: CrisisReport[] = []

  if (!stratify) {
    for (const group of groups) {
      const target = bucket(group.sourceId, salt) < ratio ? evaluation : train
      target.push(...group.members)
    }
    return { train, evaluation }
  }

  const byEvent = new Map<string, SourceGroup[]>()
  for (const group of groups) {
    const list = byEvent.get(group.eventId)
    if (list) list.push(group)
    else byEvent.set(group.eventId, [group])
  }

  for (const eventGroups of byEvent.values()) {
    /*
     * Ranked by hash and cut at the ratio, rather than each source deciding
     * independently. Independent decisions leave a small event with every
     * source on one side by chance, and an event that contributes nothing to
     * evaluation contributes nothing to the score either.
     */
    const ranked = [...eventGroups].sort(
      (a, b) => bucket(a.sourceId, salt) - bucket(b.sourceId, salt),
    )
    const take = Math.max(
      eventGroups.length >= 2 ? 1 : 0,
      Math.round(ranked.length * ratio),
    )

    ranked.forEach((group, index) => {
      const target = index < take ? evaluation : train
      target.push(...group.members)
    })
  }

  return { train, evaluation }
}

export interface LeakReport {
  leaked: boolean
  /** Source ids with records on both sides. Should always be empty. */
  offendingSources: string[]
}

/**
 * Verifies the invariant directly, rather than trusting the splitter.
 *
 * Worth running on every evaluation. A leak does not announce itself — it
 * shows up as unusually good scores, which is the last thing anyone
 * investigates.
 */
export function checkForLeaks(split: Split): LeakReport {
  const sideOf = new Map<string, Set<'train' | 'evaluation'>>()

  const note = (report: CrisisReport, side: 'train' | 'evaluation') => {
    const sourceId = report.variantOf ?? report.id
    const sides = sideOf.get(sourceId)
    if (sides) sides.add(side)
    else sideOf.set(sourceId, new Set([side]))
  }

  for (const r of split.train) note(r, 'train')
  for (const r of split.evaluation) note(r, 'evaluation')

  const offendingSources = [...sideOf.entries()]
    .filter(([, sides]) => sides.size > 1)
    .map(([sourceId]) => sourceId)
    .sort()

  return { leaked: offendingSources.length > 0, offendingSources }
}
