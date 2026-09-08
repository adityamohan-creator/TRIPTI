import { type Coords, haversineKm, travelHours } from './match.js'

/**
 * Who should run a mission.
 *
 * Pure and deterministic, like every other decision in `engine/`: a volunteer
 * being told to drive across a city deserves an answer better than "the
 * algorithm said so", and a coordinator overriding the suggestion needs to see
 * what drove it.
 */

export interface VolunteerCandidate {
  userId: string
  name: string | null
  skills: string[]
  availability: 'available' | 'busy' | 'offline'
  at: Coords | null
  maxConcurrentMissions: number
  /** Missions already accepted and not yet finished. */
  activeMissions: number
  vehicleId: string | null
}

export interface VehicleCandidate {
  id: string
  label: string
  ownerId: string | null
  capacityUnits: number | null
  refrigerated: boolean
  availability: 'available' | 'busy' | 'offline'
  at: Coords | null
}

export interface MissionRequirement {
  /** Where the goods are collected. */
  pickup: Coords
  /** Where they are delivered. */
  dropoff: Coords
  kind: string
  quantity: number | null
  /** True when the load must stay cold. */
  refrigerated: boolean
  /** Skills a volunteer must hold to be eligible at all. */
  requiredSkills?: string[]
}

export interface AssignmentWeights {
  proximity: number
  skills: number
  spareCapacity: number
  vehicle: number
}

export const DEFAULT_ASSIGNMENT_WEIGHTS: AssignmentWeights = {
  proximity: 0.4,
  skills: 0.25,
  spareCapacity: 0.2,
  vehicle: 0.15,
}

export interface AssignmentTerm {
  key: keyof AssignmentWeights
  label: string
  normalised: number
  weight: number
  points: number
  detail: string
}

export interface Assignment {
  volunteerId: string
  volunteerName: string | null
  vehicleId: string | null
  vehicleLabel: string | null
  /** Kilometres from the volunteer to the pickup. */
  distanceToPickupKm: number | null
  /** Pickup to dropoff, plus getting to the pickup. */
  estimatedMinutes: number | null
  score: number
  terms: AssignmentTerm[]
}

export interface AssignmentResult {
  /** Best first. Empty when nobody is eligible. */
  candidates: Assignment[]
  /** Why people were ruled out, so a coordinator can fix it. */
  excluded: { volunteerId: string; name: string | null; reason: string }[]
}

/** Past this a volunteer is not a realistic first call. */
const PROXIMITY_CEILING_KM = 30

const round2 = (n: number) => Math.round(n * 100) / 100
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/**
 * A vehicle is suitable when it can hold the load and keep it in the state it
 * needs to arrive in. Refrigeration is a hard requirement, not a preference —
 * warm food delivered to a shelter is a health incident, not a delivery.
 */
export function vehicleSuits(
  vehicle: VehicleCandidate,
  requirement: MissionRequirement,
): boolean {
  if (vehicle.availability !== 'available') return false
  if (requirement.refrigerated && !vehicle.refrigerated) return false
  if (requirement.quantity == null || vehicle.capacityUnits == null) return true
  return vehicle.capacityUnits >= requirement.quantity
}

function skillFit(
  volunteer: VolunteerCandidate,
  required: string[],
): { value: number; detail: string } {
  if (required.length === 0) {
    return { value: 1, detail: 'No particular skill is needed for this run.' }
  }
  const held = required.filter((skill) => volunteer.skills.includes(skill))
  return {
    value: held.length / required.length,
    detail:
      held.length === required.length
        ? `Holds all of: ${required.join(', ')}.`
        : `Holds ${held.length} of ${required.length}: missing ${required.filter((s) => !held.includes(s)).join(', ')}.`,
  }
}

/**
 * Proposes who runs a mission.
 *
 * Availability, skills and vehicle suitability are gates rather than scores —
 * an offline volunteer with a perfect location is not a good match, they are
 * not a match. Everything that survives the gates is ranked, and everything
 * that does not is returned with a reason.
 */
export function assignMission(
  requirement: MissionRequirement,
  volunteers: VolunteerCandidate[],
  vehicles: VehicleCandidate[],
  weights: AssignmentWeights = DEFAULT_ASSIGNMENT_WEIGHTS,
): AssignmentResult {
  const candidates: Assignment[] = []
  const excluded: AssignmentResult['excluded'] = []

  const legKm = haversineKm(requirement.pickup, requirement.dropoff)
  const required = requirement.requiredSkills ?? []

  for (const volunteer of volunteers) {
    if (volunteer.availability !== 'available') {
      excluded.push({
        volunteerId: volunteer.userId,
        name: volunteer.name,
        reason: `Marked ${volunteer.availability}.`,
      })
      continue
    }

    if (volunteer.activeMissions >= volunteer.maxConcurrentMissions) {
      excluded.push({
        volunteerId: volunteer.userId,
        name: volunteer.name,
        reason: `Already running ${volunteer.activeMissions} of ${volunteer.maxConcurrentMissions} missions.`,
      })
      continue
    }

    const skills = skillFit(volunteer, required)
    if (skills.value < 1 && required.length > 0) {
      excluded.push({
        volunteerId: volunteer.userId,
        name: volunteer.name,
        reason: skills.detail,
      })
      continue
    }

    // Their own vehicle first; otherwise the best unowned one that suits.
    const own = vehicles.find((v) => v.id === volunteer.vehicleId)
    const usable =
      own && vehicleSuits(own, requirement)
        ? own
        : vehicles.find((v) => vehicleSuits(v, requirement) && v.ownerId === volunteer.userId) ??
          vehicles.find((v) => vehicleSuits(v, requirement) && v.ownerId === null)

    if (requirement.refrigerated && !usable) {
      excluded.push({
        volunteerId: volunteer.userId,
        name: volunteer.name,
        reason: 'No refrigerated vehicle available to them for this load.',
      })
      continue
    }

    const distanceToPickupKm = volunteer.at
      ? round2(haversineKm(volunteer.at, requirement.pickup))
      : null

    const proximity =
      distanceToPickupKm === null ? 0.5 : clamp01(1 - distanceToPickupKm / PROXIMITY_CEILING_KM)

    const spare = clamp01(
      (volunteer.maxConcurrentMissions - volunteer.activeMissions) /
        volunteer.maxConcurrentMissions,
    )

    const vehicleFit = usable ? 1 : 0.4

    const terms: AssignmentTerm[] = [
      {
        key: 'proximity',
        label: 'Proximity to pickup',
        normalised: round2(proximity),
        weight: weights.proximity,
        points: round2(proximity * weights.proximity * 100),
        detail:
          distanceToPickupKm === null
            ? 'Location not shared, so distance is unknown.'
            : `${distanceToPickupKm} km from the collection point.`,
      },
      {
        key: 'skills',
        label: 'Skills',
        normalised: round2(skills.value),
        weight: weights.skills,
        points: round2(skills.value * weights.skills * 100),
        detail: skills.detail,
      },
      {
        key: 'spareCapacity',
        label: 'Spare capacity',
        normalised: round2(spare),
        weight: weights.spareCapacity,
        points: round2(spare * weights.spareCapacity * 100),
        detail: `${volunteer.activeMissions} of ${volunteer.maxConcurrentMissions} missions in hand.`,
      },
      {
        key: 'vehicle',
        label: 'Vehicle',
        normalised: vehicleFit,
        weight: weights.vehicle,
        points: round2(vehicleFit * weights.vehicle * 100),
        detail: usable
          ? `${usable.label}${usable.refrigerated ? ', refrigerated' : ''}.`
          : 'No suitable vehicle — they would need to arrange transport.',
      },
    ]

    const totalKm = (distanceToPickupKm ?? 0) + legKm

    candidates.push({
      volunteerId: volunteer.userId,
      volunteerName: volunteer.name,
      vehicleId: usable?.id ?? null,
      vehicleLabel: usable?.label ?? null,
      distanceToPickupKm,
      estimatedMinutes: Math.round(travelHours(totalKm) * 60),
      score: round2(terms.reduce((sum, t) => sum + t.points, 0)),
      terms,
    })
  }

  candidates.sort(
    (a, b) => b.score - a.score || (a.distanceToPickupKm ?? 1e9) - (b.distanceToPickupKm ?? 1e9),
  )

  return { candidates, excluded }
}
