import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ASSIGNMENT_WEIGHTS,
  type MissionRequirement,
  type VehicleCandidate,
  type VolunteerCandidate,
  assignMission,
  vehicleSuits,
} from './assignment.js'

const DELHI = { lat: 28.6139, lon: 77.209 }
const NOIDA = { lat: 28.5355, lon: 77.391 }
const MUMBAI = { lat: 19.076, lon: 72.8777 }

function volunteer(over: Partial<VolunteerCandidate> = {}): VolunteerCandidate {
  return {
    userId: 'v1',
    name: 'Asha',
    skills: [],
    availability: 'available',
    at: DELHI,
    maxConcurrentMissions: 2,
    activeMissions: 0,
    vehicleId: null,
    ...over,
  }
}

function vehicle(over: Partial<VehicleCandidate> = {}): VehicleCandidate {
  return {
    id: 'car1',
    label: 'Van A',
    ownerId: null,
    capacityUnits: 1000,
    refrigerated: false,
    availability: 'available',
    at: DELHI,
    ...over,
  }
}

function requirement(over: Partial<MissionRequirement> = {}): MissionRequirement {
  return {
    pickup: DELHI,
    dropoff: NOIDA,
    kind: 'food',
    quantity: 100,
    refrigerated: false,
    ...over,
  }
}

describe('assignment weights', () => {
  it('sum to one, so a score reads as a percentage', () => {
    const total = Object.values(DEFAULT_ASSIGNMENT_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(1, 10)
  })

  it('account for the whole score', () => {
    const { candidates } = assignMission(requirement(), [volunteer()], [vehicle()])
    const summed = candidates[0]!.terms.reduce((s, t) => s + t.points, 0)
    expect(summed).toBeCloseTo(candidates[0]!.score, 1)
  })
})

describe('gates — not a low score, not a match', () => {
  it('excludes an offline volunteer however well placed', () => {
    const { candidates, excluded } = assignMission(
      requirement(),
      [volunteer({ availability: 'offline', at: DELHI })],
      [vehicle()],
    )
    expect(candidates).toEqual([])
    expect(excluded[0]!.reason).toMatch(/offline/i)
  })

  it('excludes a volunteer already at their mission limit', () => {
    const { candidates, excluded } = assignMission(
      requirement(),
      [volunteer({ activeMissions: 2, maxConcurrentMissions: 2 })],
      [vehicle()],
    )
    expect(candidates).toEqual([])
    expect(excluded[0]!.reason).toMatch(/already running 2 of 2/i)
  })

  it('excludes a volunteer missing a required skill, and says which', () => {
    const { candidates, excluded } = assignMission(
      requirement({ requiredSkills: ['first-aid', 'driving'] }),
      [volunteer({ skills: ['driving'] })],
      [vehicle()],
    )
    expect(candidates).toEqual([])
    expect(excluded[0]!.reason).toMatch(/missing first-aid/i)
  })

  it('excludes everyone when a cold load has no refrigerated vehicle', () => {
    const { candidates, excluded } = assignMission(
      requirement({ refrigerated: true }),
      [volunteer()],
      [vehicle({ refrigerated: false })],
    )
    expect(candidates).toEqual([])
    expect(excluded[0]!.reason).toMatch(/refrigerated/i)
  })

  it('allows a warm load with no vehicle, at a cost', () => {
    const { candidates } = assignMission(requirement(), [volunteer()], [])
    expect(candidates).toHaveLength(1)
    const term = candidates[0]!.terms.find((t) => t.key === 'vehicle')!
    expect(term.normalised).toBeLessThan(1)
    expect(term.detail).toMatch(/arrange transport/i)
  })
})

describe('ranking', () => {
  it('prefers the nearer volunteer', () => {
    const { candidates } = assignMission(
      requirement(),
      [
        volunteer({ userId: 'far', at: MUMBAI }),
        volunteer({ userId: 'near', at: DELHI }),
      ],
      [vehicle()],
    )
    expect(candidates[0]!.volunteerId).toBe('near')
  })

  it('prefers the volunteer with more capacity left', () => {
    const { candidates } = assignMission(
      requirement(),
      [
        volunteer({ userId: 'busy', activeMissions: 3, maxConcurrentMissions: 4 }),
        volunteer({ userId: 'free', activeMissions: 0, maxConcurrentMissions: 4 }),
      ],
      [vehicle()],
    )
    expect(candidates[0]!.volunteerId).toBe('free')
  })

  it('scores an unknown location neutrally rather than as nearby', () => {
    const { candidates } = assignMission(
      requirement(),
      [volunteer({ at: null })],
      [vehicle()],
    )
    const term = candidates[0]!.terms.find((t) => t.key === 'proximity')!
    expect(term.normalised).toBe(0.5)
    expect(term.detail).toMatch(/not shared/i)
    expect(candidates[0]!.distanceToPickupKm).toBeNull()
  })

  it('picks the volunteer their own vehicle, not a shared one', () => {
    const { candidates } = assignMission(
      requirement(),
      [volunteer({ vehicleId: 'mine' })],
      [vehicle({ id: 'shared' }), vehicle({ id: 'mine', label: 'My van' })],
    )
    expect(candidates[0]!.vehicleId).toBe('mine')
  })

  it('estimates the whole trip, not just the delivery leg', () => {
    const { candidates } = assignMission(
      requirement(),
      [volunteer({ at: NOIDA })],
      [vehicle()],
    )
    // Volunteer is at the dropoff, so they must drive to the pickup and back.
    expect(candidates[0]!.estimatedMinutes).toBeGreaterThan(60)
  })
})

describe('vehicleSuits', () => {
  it('rejects a vehicle that is not available', () => {
    expect(vehicleSuits(vehicle({ availability: 'busy' }), requirement())).toBe(false)
  })

  it('rejects a warm vehicle for a cold load', () => {
    expect(vehicleSuits(vehicle(), requirement({ refrigerated: true }))).toBe(false)
  })

  it('rejects a vehicle too small for the load', () => {
    expect(vehicleSuits(vehicle({ capacityUnits: 50 }), requirement({ quantity: 500 }))).toBe(
      false,
    )
  })

  it('accepts when capacity is unknown on either side', () => {
    expect(vehicleSuits(vehicle({ capacityUnits: null }), requirement())).toBe(true)
    expect(vehicleSuits(vehicle(), requirement({ quantity: null }))).toBe(true)
  })
})

describe('determinism', () => {
  it('gives the same answer for the same input', () => {
    const vols = [volunteer({ userId: 'a' }), volunteer({ userId: 'b', at: NOIDA })]
    const veh = [vehicle()]
    expect(JSON.stringify(assignMission(requirement(), vols, veh))).toBe(
      JSON.stringify(assignMission(requirement(), vols, veh)),
    )
  })
})
