/**
 * What a mission is allowed to do next, and who is allowed to do it.
 *
 * Pure and exhaustive on purpose. A mission's status drives whether stock is
 * still promised, whether a volunteer is expected somewhere, and what the impact
 * figures count — so an illegal jump is not a cosmetic problem. Everything the
 * database and the routes enforce is decided here, once, where it can be tested
 * without a network.
 */

export type MissionStatus =
  | 'proposed'
  | 'accepted'
  | 'en_route'
  | 'delivered'
  | 'verified'
  | 'failed'
  | 'cancelled'

export type Actor = 'assignee' | 'coordinator'

export interface Transition {
  to: MissionStatus
  /** Who may make this move. */
  actors: Actor[]
  label: string
  /** What a person should understand before doing it. */
  detail: string
  /** Requires an explicit confirmation step in the UI. */
  destructive?: boolean
}

/**
 * The graph.
 *
 * Deliberately narrow. A volunteer moves their own mission forward; only a
 * coordinator closes it. Verification is separated from delivery because a
 * delivery confirmed only by the person who made it is not independently
 * confirmed — and impact figures are counted from verified missions.
 */
const TRANSITIONS: Record<MissionStatus, Transition[]> = {
  proposed: [
    {
      to: 'accepted',
      actors: ['assignee', 'coordinator'],
      label: 'Accept',
      detail: 'You are taking this run on.',
    },
    {
      to: 'cancelled',
      actors: ['coordinator'],
      label: 'Cancel',
      detail: 'Releases the reserved stock back to the pool.',
      destructive: true,
    },
  ],

  accepted: [
    {
      to: 'en_route',
      actors: ['assignee', 'coordinator'],
      label: 'Start the run',
      detail: 'You have collected the load and are on the way.',
    },
    {
      to: 'failed',
      actors: ['assignee', 'coordinator'],
      label: 'Cannot complete',
      detail: 'Releases the stock so someone else can be sent.',
      destructive: true,
    },
    {
      to: 'cancelled',
      actors: ['coordinator'],
      label: 'Cancel',
      detail: 'Releases the reserved stock back to the pool.',
      destructive: true,
    },
  ],

  en_route: [
    {
      to: 'delivered',
      actors: ['assignee', 'coordinator'],
      label: 'Mark delivered',
      detail: 'Handed over at the destination. A coordinator confirms it separately.',
    },
    {
      to: 'failed',
      actors: ['assignee', 'coordinator'],
      label: 'Could not deliver',
      detail: 'Releases the stock so someone else can be sent.',
      destructive: true,
    },
  ],

  delivered: [
    {
      to: 'verified',
      actors: ['coordinator'],
      label: 'Verify delivery',
      detail: 'Confirms it arrived. Only verified deliveries count toward impact.',
    },
    {
      to: 'failed',
      actors: ['coordinator'],
      label: 'Dispute',
      detail: 'The delivery could not be confirmed.',
      destructive: true,
    },
  ],

  // Terminal. A mission that is done is done; a correction is a new mission,
  // so the record of what happened stays true.
  verified: [],
  failed: [],
  cancelled: [],
}

export const TERMINAL: MissionStatus[] = ['verified', 'failed', 'cancelled']

export function isTerminal(status: MissionStatus): boolean {
  return TERMINAL.includes(status)
}

/** Everything possible from here, unfiltered by who is asking. */
export function transitionsFrom(status: MissionStatus): Transition[] {
  return TRANSITIONS[status] ?? []
}

/** What this particular actor may do from here. */
export function allowedTransitions(status: MissionStatus, actor: Actor): Transition[] {
  return transitionsFrom(status).filter((t) => t.actors.includes(actor))
}

export interface TransitionCheck {
  ok: boolean
  /** Why not, phrased for the person who tried. */
  reason?: string
  transition?: Transition
}

/**
 * Whether this move is legal.
 *
 * Distinguishes three failures a caller has to tell apart: the mission is
 * finished, the move does not exist, and the move exists but not for you.
 */
export function canTransition(
  from: MissionStatus,
  to: MissionStatus,
  actor: Actor,
): TransitionCheck {
  if (from === to) {
    return { ok: false, reason: `This mission is already ${from}.` }
  }

  if (isTerminal(from)) {
    return {
      ok: false,
      reason: `This mission is ${from} and cannot change. Create a new one instead.`,
    }
  }

  const transition = transitionsFrom(from).find((t) => t.to === to)
  if (!transition) {
    const options = transitionsFrom(from).map((t) => t.to)
    return {
      ok: false,
      reason: `A mission cannot go from ${from} to ${to}. From here it can only become: ${options.join(', ')}.`,
    }
  }

  if (!transition.actors.includes(actor)) {
    return {
      ok: false,
      reason:
        actor === 'assignee'
          ? `Only a coordinator can mark a mission ${to}.`
          : `Only the assigned volunteer can mark a mission ${to}.`,
    }
  }

  return { ok: true, transition }
}

/**
 * What should happen to the reserved stock on this move.
 *
 * `consume` — it was delivered, so it leaves the pool for good.
 * `release`  — it was not, so it goes back for someone else.
 * `hold`     — still in flight; the promise stands.
 *
 * Getting this wrong is how a pool silently shrinks: a cancelled mission that
 * never releases its reservation makes stock invisible to every future plan
 * while sitting untouched in a warehouse.
 */
export function stockEffect(to: MissionStatus): 'consume' | 'release' | 'hold' {
  if (to === 'delivered') return 'consume'
  if (to === 'failed' || to === 'cancelled') return 'release'
  return 'hold'
}
