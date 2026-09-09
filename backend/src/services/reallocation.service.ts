import {
  type Commitment,
  MIN_PRIORITY_GAIN,
  proposeReallocation,
} from '../engine/reallocation.js'
import { conflict, notFound } from '../lib/errors.js'
import { recordStatusChange } from '../lib/history.js'
import type { AuthUser } from '../middleware/auth.js'
import { admin } from '../supabase.js'
import { loadPool } from './matching.service.js'

/**
 * Reallocation: the proposal, and its execution.
 *
 * The engine decides what may move; this loads the facts, stores the proposal,
 * and applies it once a person says yes. The split matters more here than
 * anywhere else in the project — a coordinator approving this is taking a
 * delivery away from one group of people, and the reasoning has to be
 * inspectable long after the pool has moved on.
 */

interface MatchRow {
  id: string
  need_id: string
  resource_id: string
  allocated_quantity: number | null
  status: string
}

interface MissionRow {
  match_id: string | null
  status: string
  assigned_to: string | null
}

/** Everything currently holding stock, with how firmly it holds it. */
async function loadCommitments(): Promise<Commitment[]> {
  const [{ data: matches, error: matchError }, { data: missions, error: missionError }] =
    await Promise.all([
      admin
        .from('matches')
        .select('id, need_id, resource_id, allocated_quantity, status')
        .in('status', ['proposed', 'reserved', 'committed']),
      admin.from('missions').select('match_id, status, assigned_to').not('match_id', 'is', null),
    ])

  if (matchError) throw matchError
  if (missionError) throw missionError

  const missionByMatch = new Map<string, MissionRow>()
  for (const row of (missions ?? []) as MissionRow[]) {
    if (row.match_id) missionByMatch.set(row.match_id, row)
  }

  return ((matches ?? []) as MatchRow[]).map((match) => {
    const mission = missionByMatch.get(match.id)
    return {
      matchId: match.id,
      needId: match.need_id,
      resourceId: match.resource_id,
      quantity: match.allocated_quantity,
      missionStatus: (mission?.status ?? null) as Commitment['missionStatus'],
      assigned: Boolean(mission?.assigned_to),
    }
  })
}

export interface ReallocationOptions {
  minPriorityGain?: number
  triggeredByIncident?: string | null
}

/**
 * What would move, and what would not.
 *
 * Read-only. Looking at a reallocation must not perform one — this is the
 * screen a coordinator opens when a bad incident arrives, and opening it should
 * not commit them to anything.
 */
export async function previewReallocation(options: ReallocationOptions = {}) {
  const now = Date.now()
  const [pool, commitments] = await Promise.all([loadPool(now), loadCommitments()])

  const proposal = proposeReallocation({
    needs: pool.needs,
    resources: pool.resources,
    commitments,
    vehicles: pool.vehicles,
    minPriorityGain: options.minPriorityGain ?? MIN_PRIORITY_GAIN,
    now,
  })

  return {
    ...proposal,
    minPriorityGain: options.minPriorityGain ?? MIN_PRIORITY_GAIN,
    needsMissingCoordinates: pool.needsMissingCoordinates,
  }
}

/** Stores a proposal so it can be reviewed and approved as a unit. */
export async function createReallocation(
  user: AuthUser,
  options: ReallocationOptions = {},
) {
  const proposal = await previewReallocation(options)

  if (proposal.moves.length === 0) {
    throw conflict(
      'Nothing can usefully be moved. Every commitment is either already in motion or serving a need at least as urgent.',
    )
  }

  const { data, error } = await admin
    .from('reallocations')
    .insert({
      label: `Reallocation ${new Date().toLocaleString()}`,
      status: 'proposed',
      moves: proposal.moves,
      protected_commitments: proposal.protectedCommitments,
      still_unserved: proposal.stillUnserved,
      min_priority_gain: proposal.minPriorityGain,
      triggered_by_incident: options.triggeredByIncident ?? null,
      created_by: user.id,
    })
    .select('*')
    .single()

  if (error) throw error

  await recordStatusChange({
    entityType: 'plan',
    entityId: data.id,
    fromStatus: null,
    toStatus: 'proposed',
    changedBy: user.id,
    note: `Reallocation proposed: ${proposal.moves.length} move(s), ${proposal.protectedCommitments.length} commitment(s) protected.`,
  })

  return { reallocation: data }
}

export async function listReallocations() {
  const { data, error } = await admin
    .from('reallocations')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw error
  return { reallocations: data }
}

export async function getReallocation(id: string) {
  const { data, error } = await admin
    .from('reallocations')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) throw notFound('No such reallocation')
  return { reallocation: data }
}

interface StoredMove {
  matchId: string
  toNeedId: string
  quantity: number | null
  fromNeedId: string
  priorityGain: number
}

/**
 * Applies an approved reallocation.
 *
 * Each move is re-checked at the moment it is applied, not trusted from the
 * proposal. Between a coordinator reading the screen and pressing approve, a
 * volunteer may have accepted the very run being taken away — and that person
 * wins. A move that loses is skipped and reported, never forced.
 */
export async function approveReallocation(user: AuthUser, id: string, note?: string | null) {
  const { reallocation } = await getReallocation(id)

  if (reallocation.status !== 'proposed') {
    throw conflict(`This reallocation is already ${reallocation.status}.`)
  }

  const moves = (reallocation.moves ?? []) as StoredMove[]
  const applied: StoredMove[] = []
  const skipped: { matchId: string; reason: string }[] = []

  for (const move of moves) {
    const { data: ok, error } = await admin.rpc('reallocate_match', {
      p_match_id: move.matchId,
      p_to_need_id: move.toNeedId,
      p_quantity: move.quantity,
    })

    if (error) throw error

    if (ok) applied.push(move)
    else {
      skipped.push({
        matchId: move.matchId,
        reason:
          'A volunteer took this run on between the proposal and now, so it was left alone.',
      })
    }
  }

  const { error: updateError } = await admin
    .from('reallocations')
    .update({
      status: 'approved',
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      note: note ?? reallocation.note,
      still_unserved: [
        ...((reallocation.still_unserved ?? []) as unknown[]),
        ...skipped.map((s) => ({ needId: s.matchId, reason: s.reason })),
      ],
    })
    .eq('id', id)

  if (updateError) throw updateError

  await recordStatusChange({
    entityType: 'plan',
    entityId: id,
    fromStatus: 'proposed',
    toStatus: 'approved',
    changedBy: user.id,
    note: `Reallocation approved: ${applied.length} of ${moves.length} move(s) applied${skipped.length ? `, ${skipped.length} skipped because a volunteer had taken the run on` : ''}.`,
  })

  // Every move is a change to two needs; recording it against each keeps the
  // trail readable from either side.
  for (const move of applied) {
    for (const needId of [move.fromNeedId, move.toNeedId]) {
      await recordStatusChange({
        entityType: 'need',
        entityId: needId,
        fromStatus: null,
        toStatus: needId === move.toNeedId ? 'reallocated_in' : 'reallocated_out',
        changedBy: user.id,
        note: `Stock moved by reallocation ${reallocation.label ?? id} (+${move.priorityGain.toFixed(0)} priority).`,
      })
    }
  }

  return { applied: applied.length, skipped, total: moves.length }
}

export async function discardReallocation(user: AuthUser, id: string, note?: string | null) {
  const { reallocation } = await getReallocation(id)

  if (reallocation.status === 'approved') {
    throw conflict('This reallocation has already been applied and cannot be discarded.')
  }

  const { error } = await admin
    .from('reallocations')
    .update({ status: 'discarded', note: note ?? reallocation.note })
    .eq('id', id)

  if (error) throw error

  await recordStatusChange({
    entityType: 'plan',
    entityId: id,
    fromStatus: reallocation.status,
    toStatus: 'discarded',
    changedBy: user.id,
    note: note ?? 'Reallocation discarded; nothing was moved.',
  })

  return { discarded: true }
}
