import { type Need, type Resource, type Vehicle, matchNeeds } from './match.js'
import { priorityBreakdown } from './priority.js'

/**
 * Moving already-promised stock to somewhere it is needed more.
 *
 * This is the one place in TRIPTI that proposes taking something away from a
 * need that was already going to be served, so it is written to be cautious in
 * a specific direction: it would rather leave stock where it is than disturb a
 * response already in motion. Everything it declines to touch is reported with
 * a reason, because a coordinator has to be able to see what was protected and
 * overrule it by hand if they judge differently.
 *
 * Nothing here writes. It proposes; a person approves.
 */

/** Stock currently promised to a need, and how firmly. */
export interface Commitment {
  matchId: string
  needId: string
  resourceId: string
  /** Units held. Null for an unmetered claim. */
  quantity: number | null
  /** Null when no mission exists yet — the plan is only reserved. */
  missionStatus:
    | 'proposed'
    | 'accepted'
    | 'en_route'
    | 'delivered'
    | 'verified'
    | 'failed'
    | 'cancelled'
    | null
  /** Whether a volunteer has been named, even if they have not accepted. */
  assigned: boolean
}

export interface ReleasableCheck {
  releasable: boolean
  /** Why not. Phrased for a coordinator reading a list of what was left alone. */
  reason?: string
}

/**
 * The minimum a receiving need must outscore a donor need by, in priority
 * points, before a move is proposed.
 *
 * Without it the planner would shuffle stock between near-equal needs on every
 * recomputation — churn that produces new missions, new drives and no benefit.
 * Reallocation should be reserved for a genuine difference in who is worse off.
 */
export const MIN_PRIORITY_GAIN = 15

/**
 * Whether this commitment may be taken back.
 *
 * The rules are deliberately blunt, and all of them fail closed:
 *
 * Once a volunteer has accepted, they are arranging their day around it, and
 * once they are en route they may be standing in a warehouse. Reassigning
 * underneath them is how someone drives to collect a load that is no longer
 * theirs.
 *
 * Delivered and verified stock has already left the pool; there is nothing to
 * take. Failed and cancelled work released its hold when it ended.
 *
 * A life-critical need — rescue, medical, evacuation — is never a donor. If the
 * arriving incident is worse, a coordinator can make that call explicitly; an
 * algorithm should not make it quietly.
 */
export function isReleasable(
  commitment: Commitment,
  donorNeed: Need | undefined,
): ReleasableCheck {
  /*
   * An unknown donor is protected, not permitted.
   *
   * Every check below reads the need it serves. If that need was not loaded,
   * `lifeCritical` is undefined and reads as false, so a rescue commitment
   * looks fair game; its priority reads as 0, so any move clears the churn gate
   * by a mile. The absence of information must never present as permission.
   */
  if (!donorNeed) {
    return {
      releasable: false,
      reason: 'The need it serves could not be identified, so it is left alone.',
    }
  }

  if (donorNeed.lifeCritical) {
    return {
      releasable: false,
      reason: 'The need it serves is life-critical and is never reallocated automatically.',
    }
  }

  switch (commitment.missionStatus) {
    case 'accepted':
      return { releasable: false, reason: 'A volunteer has accepted this run.' }
    case 'en_route':
      return { releasable: false, reason: 'A volunteer is already on the way.' }
    case 'delivered':
    case 'verified':
      return { releasable: false, reason: 'Already delivered — the stock has gone.' }
    case 'failed':
    case 'cancelled':
      return { releasable: false, reason: 'This run ended; its stock is already back in the pool.' }
    case 'proposed':
      return commitment.assigned
        ? {
            releasable: false,
            reason: 'A volunteer has been named and may already be planning around it.',
          }
        : { releasable: true }
    case null:
      // Reserved by a plan nobody has approved. Nothing has been promised to a
      // person yet, so this is the safest stock to move.
      return { releasable: true }
  }
}

export interface ReallocationMove {
  resourceId: string
  quantity: number | null
  fromNeedId: string
  fromPriority: number
  toNeedId: string
  toPriority: number
  priorityGain: number
  matchId: string
  distanceKm: number
  score: number
  rationale: string
}

export interface ReallocationProposal {
  moves: ReallocationMove[]
  /** Commitments left alone, and why. The list a coordinator scans to disagree. */
  protectedCommitments: { matchId: string; needId: string; reason: string }[]
  /** Needs that stay unserved even after everything movable was considered. */
  stillUnserved: { needId: string; reason: string }[]
}

export interface ReallocationInput {
  /** Every need currently open, including the new arrival. */
  needs: Need[]
  /** The pool as it stands, with reservations already applied. */
  resources: Resource[]
  commitments: Commitment[]
  vehicles?: Vehicle[]
  minPriorityGain?: number
  now?: number
}

/**
 * Proposes what to move.
 *
 * The method is deliberately simple enough to explain: work out which
 * commitments may be touched, hand the matcher a pool that pretends those are
 * free, and keep only the pairings that put stock somewhere materially worse
 * off than where it is now.
 *
 * Simple matters more than optimal here. A coordinator is being asked to take a
 * truck away from one group of people and give it to another, and they can only
 * agree to that if they can follow the reasoning.
 */
export function proposeReallocation(input: ReallocationInput): ReallocationProposal {
  const now = input.now ?? Date.now()
  const gate = input.minPriorityGain ?? MIN_PRIORITY_GAIN

  const needById = new Map(input.needs.map((n) => [n.id, n]))
  const priorityOf = (needId: string) => {
    const need = needById.get(needId)
    return need ? priorityBreakdown(need).score : 0
  }

  const releasable: Commitment[] = []
  const protectedCommitments: ReallocationProposal['protectedCommitments'] = []

  for (const commitment of input.commitments) {
    const check = isReleasable(commitment, needById.get(commitment.needId))
    if (check.releasable) releasable.push(commitment)
    else {
      protectedCommitments.push({
        matchId: commitment.matchId,
        needId: commitment.needId,
        reason: check.reason ?? 'Protected.',
      })
    }
  }

  // Hand the matcher a pool where releasable stock reads as available again.
  const freed = new Map<string, number>()
  for (const commitment of releasable) {
    if (commitment.quantity == null) continue
    freed.set(commitment.resourceId, (freed.get(commitment.resourceId) ?? 0) + commitment.quantity)
  }

  const hypothetical: Resource[] = input.resources.map((resource) => ({
    ...resource,
    reservedQuantity: Math.max(0, resource.reservedQuantity - (freed.get(resource.id) ?? 0)),
  }))

  // Needs whose commitment is protected keep it: they must not be offered stock
  // they are already receiving, or the plan would double-count them.
  const protectedNeedIds = new Set(protectedCommitments.map((p) => p.needId))
  const candidates = input.needs.filter((n) => !protectedNeedIds.has(n.id))

  const { matches } = matchNeeds(candidates, hypothetical, {
    vehicles: input.vehicles,
    now,
  })

  const moves: ReallocationMove[] = []
  const takenFrom = new Set<string>()

  for (const match of matches) {
    // Which releasable commitment would have to give this up.
    const donor = releasable.find(
      (c) => c.resourceId === match.resourceId && !takenFrom.has(c.matchId),
    )
    if (!donor) continue
    if (donor.needId === match.needId) continue // already theirs; not a move

    const fromPriority = priorityOf(donor.needId)
    const toPriority = priorityOf(match.needId)
    const gain = Math.round((toPriority - fromPriority) * 100) / 100

    if (gain < gate) continue

    takenFrom.add(donor.matchId)
    moves.push({
      resourceId: match.resourceId,
      quantity: match.quantity,
      fromNeedId: donor.needId,
      fromPriority,
      toNeedId: match.needId,
      toPriority,
      priorityGain: gain,
      matchId: donor.matchId,
      distanceKm: match.distanceKm,
      score: match.score,
      rationale: `The receiving need scores ${toPriority.toFixed(0)} against ${fromPriority.toFixed(0)} — ${gain.toFixed(0)} points worse off — and nothing has been promised to a volunteer for the current one.`,
    })
  }

  const served = new Set([
    ...moves.map((m) => m.toNeedId),
    ...input.commitments.map((c) => c.needId),
  ])

  const stillUnserved = input.needs
    .filter((n) => !served.has(n.id))
    .map((n) => ({
      needId: n.id,
      reason:
        releasable.length === 0
          ? 'Nothing in the pool can be moved — every commitment is already in motion.'
          : 'No movable stock of the right kind is close enough to help.',
    }))

  return { moves, protectedCommitments, stillUnserved }
}
