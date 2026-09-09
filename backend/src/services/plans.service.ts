import { DEFAULT_MATCH_WEIGHTS } from '../engine/match.js'
import { conflict, notFound } from '../lib/errors.js'
import { recordStatusChange } from '../lib/history.js'
import type { AuthUser } from '../middleware/auth.js'
import { admin } from '../supabase.js'
import type { PlanMatchRow, ResponsePlanRow } from '../types/db.js'
import { coverageOf, loadPool, previewPlan } from './matching.service.js'
import { matchNeeds } from '../engine/match.js'

/**
 * A response plan is the proposal a coordinator approves.
 *
 * Creating one reserves stock; approving one turns reserved stock into
 * missions; discarding one gives the stock back. Nothing here decides *what* to
 * match — that is the engine's job, and it has already run by the time these
 * functions do anything.
 */

const STAFF = ['coordinator', 'admin']

/**
 * Supabase infers row types from a *literal* select string. These are composed,
 * so inference falls back to GenericStringError and the compiler cannot see the
 * shape. Narrowing happens here — once, against the migrations — until
 * generated database types land.
 */
const asMatches = (value: unknown): PlanMatchRow[] => (value ?? []) as PlanMatchRow[]
const asPlan = (value: unknown): ResponsePlanRow => value as ResponsePlanRow

export interface CreatePlanInput {
  label?: string | null
  note?: string | null
}

/**
 * Builds a plan and reserves everything in it.
 *
 * Reservation goes through `reserve_resource`, which checks and increments in
 * one statement. A match whose reservation loses a race is dropped from the
 * plan and reported rather than retried: the pool has changed underneath, and
 * silently re-planning would hand the coordinator a plan they never saw.
 */
export async function createPlan(user: AuthUser, input: CreatePlanInput) {
  const now = Date.now()
  const pool = await loadPool(now)
  const proposal = matchNeeds(pool.needs, pool.resources, {
    vehicles: pool.vehicles,
    now,
  })

  if (proposal.matches.length === 0) {
    throw conflict('Nothing can be matched right now — there is no plan to create.')
  }

  const { data: plan, error: planError } = await admin
    .from('response_plans')
    .insert({
      label: input.label ?? null,
      note: input.note ?? null,
      status: 'proposed',
      weights: DEFAULT_MATCH_WEIGHTS,
      unmatched: proposal.unmatched,
      coverage: coverageOf(pool.needs, proposal.matches),
      created_by: user.id,
    })
    .select('*')
    .single()

  if (planError) throw planError

  const reserved: typeof proposal.matches = []
  const lost: { needId: string; resourceId: string; reason: string }[] = []

  for (const match of proposal.matches) {
    const { data: ok, error } = await admin.rpc('reserve_resource', {
      p_resource_id: match.resourceId,
      p_amount: match.quantity,
    })

    if (error) throw error

    if (ok) {
      reserved.push(match)
    } else {
      lost.push({
        needId: match.needId,
        resourceId: match.resourceId,
        reason: 'Another plan reserved this stock first.',
      })
    }
  }

  if (reserved.length > 0) {
    const { error: matchError } = await admin.from('matches').insert(
      reserved.map((m) => ({
        plan_id: plan.id,
        need_id: m.needId,
        resource_id: m.resourceId,
        score: m.score,
        allocated_quantity: m.quantity,
        distance_km: m.distanceKm,
        rationale: { terms: m.terms, needPriority: m.needPriority },
        status: 'reserved',
        created_by: user.id,
      })),
    )
    if (matchError) throw matchError
  }

  // The stored plan describes what was actually reserved, not what was hoped
  // for, so a later reader is not misled by a race they cannot see.
  if (lost.length > 0) {
    await admin
      .from('response_plans')
      .update({
        unmatched: [
          ...proposal.unmatched,
          ...lost.map((l) => ({ needId: l.needId, reason: l.reason })),
        ],
        coverage: coverageOf(pool.needs, reserved),
      })
      .eq('id', plan.id)
  }

  await recordStatusChange({
    entityType: 'plan',
    entityId: plan.id,
    fromStatus: null,
    toStatus: 'proposed',
    changedBy: user.id,
    note: `Plan created: ${reserved.length} match(es) reserved${lost.length ? `, ${lost.length} lost to another plan` : ''}.`,
  })

  return getPlan(user, plan.id)
}

export async function listPlans(_user: AuthUser, status?: string) {
  let query = admin
    .from('response_plans')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) throw error
  return { plans: data }
}

export async function getPlan(_user: AuthUser, id: string) {
  const { data: plan, error } = await admin
    .from('response_plans')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!plan) throw notFound('No such plan')

  const { data: matches, error: matchError } = await admin
    .from('matches')
    .select(
      'id, need_id, resource_id, score, allocated_quantity, distance_km, rationale, status, ' +
        'needs(kind, unit, incident_id, incidents(summary, severity, location_text)), ' +
        'resources(label, kind, unit, address, expiry_time, perishable)',
    )
    .eq('plan_id', id)
    .order('score', { ascending: false })

  if (matchError) throw matchError

  return { plan: asPlan(plan), matches: asMatches(matches) }
}

/**
 * Turns an approved plan into missions.
 *
 * Reserved stock becomes committed; a mission is created per match. This is the
 * point where a proposal becomes something a volunteer will act on, which is
 * why it needs an explicit human decision and writes an audit row per mission.
 */
export async function approvePlan(user: AuthUser, id: string, note?: string | null) {
  if (!STAFF.includes(user.role)) throw notFound('No such plan')

  const { plan, matches } = await getPlan(user, id)

  if (plan.status !== 'proposed') {
    throw conflict(`This plan is already ${plan.status}.`)
  }
  if (matches.length === 0) {
    throw conflict('There is nothing in this plan to approve.')
  }

  const { data: missions, error: missionError } = await admin
    .from('missions')
    .insert(
      matches.map((m) => ({
        plan_id: id,
        match_id: m.id,
        need_id: m.need_id,
        resource_id: m.resource_id,
        quantity: m.allocated_quantity,
        distance_km: m.distance_km,
        need_priority: (m.rationale as { needPriority?: number })?.needPriority ?? null,
        status: 'proposed',
        created_by: user.id,
      })),
    )
    .select('id')

  if (missionError) throw missionError

  const { error: commitError } = await admin
    .from('matches')
    .update({ status: 'committed' })
    .eq('plan_id', id)
  if (commitError) throw commitError

  const { error: planError } = await admin
    .from('response_plans')
    .update({
      status: 'approved',
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      note: note ?? plan.note,
    })
    .eq('id', id)
  if (planError) throw planError

  await recordStatusChange({
    entityType: 'plan',
    entityId: id,
    fromStatus: 'proposed',
    toStatus: 'approved',
    changedBy: user.id,
    note: `Approved; ${missions?.length ?? 0} mission(s) created.`,
  })

  for (const mission of missions ?? []) {
    await recordStatusChange({
      entityType: 'mission',
      entityId: mission.id,
      fromStatus: null,
      toStatus: 'proposed',
      changedBy: user.id,
      note: `Created from approved plan ${plan.label ?? id}.`,
    })
  }

  return { plan: (await getPlan(user, id)).plan, missionsCreated: missions?.length ?? 0 }
}

/**
 * Gives the stock back.
 *
 * Releasing is the only safe way to abandon a plan: the reservations it holds
 * are invisible to the next coordinator, so leaving them in place quietly
 * shrinks the pool for everyone.
 */
export async function discardPlan(user: AuthUser, id: string, note?: string | null) {
  if (!STAFF.includes(user.role)) throw notFound('No such plan')

  const { plan, matches } = await getPlan(user, id)

  if (plan.status === 'discarded') return { plan, released: 0 }
  if (plan.status === 'approved') {
    throw conflict(
      'This plan has already produced missions. Cancel those instead — discarding would release stock a volunteer is on the way to collect.',
    )
  }

  let released = 0
  for (const match of matches) {
    const { error } = await admin.rpc('release_resource', {
      p_resource_id: match.resource_id,
      p_amount: match.allocated_quantity,
    })
    if (error) throw error
    released++
  }

  const { error: matchError } = await admin
    .from('matches')
    .update({ status: 'released' })
    .eq('plan_id', id)
  if (matchError) throw matchError

  const { error: planError } = await admin
    .from('response_plans')
    .update({ status: 'discarded', note: note ?? plan.note })
    .eq('id', id)
  if (planError) throw planError

  await recordStatusChange({
    entityType: 'plan',
    entityId: id,
    fromStatus: plan.status,
    toStatus: 'discarded',
    changedBy: user.id,
    note: `Plan discarded; ${released} reservation(s) released.`,
  })

  return { plan: (await getPlan(user, id)).plan, released }
}

export { previewPlan }
