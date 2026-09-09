import {
  type MissionRequirement,
  type VehicleCandidate,
  type VolunteerCandidate,
  assignMission,
} from '../engine/assignment.js'
import type { Coords } from '../engine/match.js'
import { conflict, notFound } from '../lib/errors.js'
import { recordStatusChange } from '../lib/history.js'
import type { AuthUser } from '../middleware/auth.js'
import { routeStops } from '../integrations/routing.js'
import { admin } from '../supabase.js'

/**
 * Missions: who runs them, in what, and by which road.
 *
 * Nothing here chooses — `engine/assignment.ts` ranks and this stores the
 * coordinator's decision. The split matters when someone asks six weeks later
 * why a particular volunteer was sent.
 */

const MISSION_COLUMNS =
  'id, plan_id, match_id, need_id, resource_id, assigned_to, vehicle_id, quantity, ' +
  'distance_km, need_priority, status, route, created_at, updated_at'

interface MissionRow {
  id: string
  need_id: string
  resource_id: string
  assigned_to: string | null
  vehicle_id: string | null
  quantity: number | null
  status: string
  needs?: unknown
  resources?: unknown
}

/** Where the goods are, and where they are going. */
async function missionGeography(mission: MissionRow): Promise<{
  pickup: Coords
  dropoff: Coords
  kind: string
  perishable: boolean
}> {
  const [{ data: resource }, { data: need }] = await Promise.all([
    admin
      .from('resources')
      .select('lat, lon, kind, perishable')
      .eq('id', mission.resource_id)
      .maybeSingle(),
    admin
      .from('needs')
      .select('kind, incidents(lat, lon)')
      .eq('id', mission.need_id)
      .maybeSingle(),
  ])

  const incident = Array.isArray(need?.incidents) ? need?.incidents[0] : need?.incidents
  const dropoff = incident as { lat: number | null; lon: number | null } | null

  if (resource?.lat == null || resource.lon == null) {
    throw conflict('The resource has no coordinates, so this mission cannot be routed.')
  }
  if (dropoff?.lat == null || dropoff.lon == null) {
    throw conflict('The incident has no coordinates, so this mission cannot be routed.')
  }

  return {
    pickup: { lat: resource.lat, lon: resource.lon },
    dropoff: { lat: dropoff.lat, lon: dropoff.lon },
    kind: resource.kind,
    perishable: Boolean(resource.perishable),
  }
}

/**
 * Which missions this person is entitled to see.
 *
 * Null means "everything" — only for roles running the response. Everyone else
 * is scoped by their relationship to the work: a volunteer sees what they were
 * given, a citizen sees the missions serving the incident they reported, a
 * donor sees the collections from their own stock. That is enough for each of
 * them to follow what is happening without handing a stranger the whole
 * dispatch board, including which volunteer is driving where.
 */
async function visibleMissionScope(
  user: AuthUser,
): Promise<{ column: 'id' | 'assigned_to' | 'need_id' | 'resource_id'; values: string[] } | null> {
  if (['ngo', 'coordinator', 'admin'].includes(user.role)) return null

  if (user.role === 'volunteer') {
    return { column: 'assigned_to', values: [user.id] }
  }

  if (user.role === 'donor') {
    const { data, error } = await admin
      .from('resources')
      .select('id')
      .eq('owner_id', user.id)
    if (error) throw error
    return { column: 'resource_id', values: (data ?? []).map((r) => r.id) }
  }

  // Citizen: the missions serving incidents they reported.
  const { data: incidents, error: incidentError } = await admin
    .from('incidents')
    .select('id')
    .eq('reported_by', user.id)
  if (incidentError) throw incidentError

  const incidentIds = (incidents ?? []).map((i) => i.id)
  if (incidentIds.length === 0) return { column: 'need_id', values: [] }

  const { data: needs, error: needError } = await admin
    .from('needs')
    .select('id')
    .in('incident_id', incidentIds)
  if (needError) throw needError

  return { column: 'need_id', values: (needs ?? []).map((n) => n.id) }
}

export async function listMissions(user: AuthUser, status?: string) {
  let query = admin
    .from('missions')
    .select(
      `${MISSION_COLUMNS}, needs(kind, unit, incidents(summary, severity, location_text, lat, lon)), ` +
        'resources(label, kind, unit, address, lat, lon, expiry_time, perishable)',
    )
    .order('created_at', { ascending: false })
    .limit(100)

  if (status) query = query.eq('status', status)

  const scope = await visibleMissionScope(user)
  if (scope) {
    // An empty scope means nothing of theirs is in flight. Filtering on an
    // empty `in` list would match every row, so return early instead.
    if (scope.values.length === 0) return { missions: [] }
    query = query.in(scope.column, scope.values)
  }

  const { data, error } = await query
  if (error) throw error
  return { missions: data ?? [] }
}

export async function getMission(user: AuthUser, id: string) {
  const { data, error } = await admin
    .from('missions')
    .select(
      `${MISSION_COLUMNS}, needs(kind, unit, incidents(summary, severity, location_text, lat, lon)), ` +
        'resources(label, kind, unit, address, lat, lon, expiry_time, perishable)',
    )
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) throw notFound('No such mission')

  const row = data as unknown as MissionRow
  const scope = await visibleMissionScope(user)

  if (scope) {
    const value =
      scope.column === 'assigned_to'
        ? row.assigned_to
        : scope.column === 'need_id'
          ? row.need_id
          : scope.column === 'resource_id'
            ? row.resource_id
            : row.id

    // 404 rather than 403: whether a mission exists is itself operational.
    if (value == null || !scope.values.includes(value)) throw notFound('No such mission')
  }

  return { mission: data }
}

/**
 * Who could run this, ranked, with the reasoning and the exclusions.
 *
 * Read-only: looking at candidates assigns nobody. The coordinator picks.
 */
export async function assignmentCandidates(_user: AuthUser, missionId: string) {
  const { data: mission, error } = await admin
    .from('missions')
    .select('id, need_id, resource_id, quantity, status')
    .eq('id', missionId)
    .maybeSingle()

  if (error) throw error
  if (!mission) throw notFound('No such mission')

  const geography = await missionGeography(mission as unknown as MissionRow)

  const [{ data: volunteerRows }, { data: vehicleRows }, { data: workload }] =
    await Promise.all([
      admin
        .from('volunteers')
        .select('user_id, skills, availability, lat, lon, max_concurrent_missions, vehicle_id, profiles(full_name)'),
      admin
        .from('vehicles')
        .select('id, label, owner_id, capacity_units, refrigerated, availability, lat, lon'),
      // One query for everyone's live load, rather than one per volunteer.
      admin
        .from('missions')
        .select('assigned_to')
        .in('status', ['accepted', 'en_route'])
        .not('assigned_to', 'is', null),
    ])

  const activeByVolunteer = new Map<string, number>()
  for (const row of workload ?? []) {
    const id = (row as { assigned_to: string }).assigned_to
    activeByVolunteer.set(id, (activeByVolunteer.get(id) ?? 0) + 1)
  }

  const volunteers: VolunteerCandidate[] = (volunteerRows ?? []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
    return {
      userId: row.user_id,
      name: (profile as { full_name?: string } | null)?.full_name ?? null,
      skills: row.skills ?? [],
      availability: row.availability,
      at: row.lat != null && row.lon != null ? { lat: row.lat, lon: row.lon } : null,
      maxConcurrentMissions: row.max_concurrent_missions ?? 1,
      activeMissions: activeByVolunteer.get(row.user_id) ?? 0,
      vehicleId: row.vehicle_id,
    }
  })

  const vehicles: VehicleCandidate[] = (vehicleRows ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    ownerId: row.owner_id,
    capacityUnits: row.capacity_units,
    refrigerated: Boolean(row.refrigerated),
    availability: row.availability,
    at: row.lat != null && row.lon != null ? { lat: row.lat, lon: row.lon } : null,
  }))

  const requirement: MissionRequirement = {
    pickup: geography.pickup,
    dropoff: geography.dropoff,
    kind: geography.kind,
    quantity: (mission as { quantity: number | null }).quantity,
    refrigerated: geography.perishable,
  }

  return { requirement, ...assignMission(requirement, volunteers, vehicles) }
}

/**
 * Records the coordinator's choice.
 *
 * The engine's ranking is advisory; a coordinator who knows a volunteer is
 * already near the pickup can pick anyone. What is enforced is what the
 * database cannot express itself — that the person exists, is available, and is
 * not already at their mission limit.
 */
export async function assignVolunteer(
  user: AuthUser,
  missionId: string,
  volunteerId: string,
  vehicleId: string | null,
) {
  const { data: mission, error } = await admin
    .from('missions')
    .select('id, status, assigned_to')
    .eq('id', missionId)
    .maybeSingle()

  if (error) throw error
  if (!mission) throw notFound('No such mission')

  if (['delivered', 'cancelled', 'failed'].includes(mission.status)) {
    throw conflict(`This mission is ${mission.status}; reassigning it would change nothing.`)
  }

  const { data: volunteer, error: volunteerError } = await admin
    .from('volunteers')
    .select('user_id, availability, max_concurrent_missions')
    .eq('user_id', volunteerId)
    .maybeSingle()

  if (volunteerError) throw volunteerError
  if (!volunteer) throw conflict('That person has not registered as a volunteer.')
  if (volunteer.availability !== 'available') {
    throw conflict(`That volunteer is marked ${volunteer.availability}.`)
  }

  const { count, error: countError } = await admin
    .from('missions')
    .select('id', { count: 'exact', head: true })
    .eq('assigned_to', volunteerId)
    .in('status', ['accepted', 'en_route'])

  if (countError) throw countError
  if ((count ?? 0) >= (volunteer.max_concurrent_missions ?? 1)) {
    throw conflict(
      `That volunteer is already running ${count} mission(s), their stated limit.`,
    )
  }

  const { data, error: updateError } = await admin
    .from('missions')
    .update({ assigned_to: volunteerId, vehicle_id: vehicleId })
    .eq('id', missionId)
    .select(MISSION_COLUMNS)
    .single()

  if (updateError) throw updateError

  await recordStatusChange({
    entityType: 'mission',
    entityId: missionId,
    fromStatus: mission.status,
    toStatus: mission.status,
    changedBy: user.id,
    note: `Assigned to ${volunteerId}${vehicleId ? ` with vehicle ${vehicleId}` : ''}.`,
  })

  return { mission: data }
}

/**
 * Computes and stores the route.
 *
 * Stored rather than computed on read, because the road network and the
 * provider both change: a mission reviewed later should show the route the
 * volunteer was actually given.
 */
export async function buildRoute(user: AuthUser, missionId: string) {
  const { data: mission, error } = await admin
    .from('missions')
    .select('id, need_id, resource_id, status')
    .eq('id', missionId)
    .maybeSingle()

  if (error) throw error
  if (!mission) throw notFound('No such mission')

  const geography = await missionGeography(mission as unknown as MissionRow)
  const route = await routeStops([geography.pickup, geography.dropoff])

  const { error: routeError } = await admin.from('routes').upsert(
    {
      mission_id: missionId,
      distance_km: route.distanceKm,
      duration_min: route.durationMin,
      geometry: route.geometry,
      provider: route.provider,
    },
    { onConflict: 'mission_id' },
  )
  if (routeError) throw routeError

  const { error: missionError } = await admin
    .from('missions')
    .update({ route, distance_km: route.distanceKm })
    .eq('id', missionId)
  if (missionError) throw missionError

  await recordStatusChange({
    entityType: 'mission',
    entityId: missionId,
    fromStatus: mission.status,
    toStatus: mission.status,
    changedBy: user.id,
    note: `Route computed: ${route.distanceKm} km, ${route.durationMin} min via ${route.provider}${route.estimated ? ' (estimated)' : ''}.`,
  })

  return { route }
}
