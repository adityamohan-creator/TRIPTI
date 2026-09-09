import { describe, expect, it } from 'vitest'
import type { Need, Resource } from './match.js'
import {
  type Commitment,
  MIN_PRIORITY_GAIN,
  isReleasable,
  proposeReallocation,
} from './reallocation.js'

const HERE = { lat: 28.6139, lon: 77.209 }
const NEAR = { lat: 28.62, lon: 77.22 }
const NOW = Date.parse('2026-09-09T12:00:00Z')

function need(over: Partial<Need> = {}): Need {
  return {
    id: 'n1',
    incidentId: 'i1',
    kind: 'water',
    quantity: 100,
    at: HERE,
    severity: 'medium',
    peopleAffected: 50,
    ageMinutes: 0,
    lifeCritical: false,
    unmet: true,
    ...over,
  }
}

function resource(over: Partial<Resource> = {}): Resource {
  return {
    id: 'r1',
    kind: 'water',
    quantity: 100,
    // Held by the existing commitment.
    reservedQuantity: 100,
    at: HERE,
    expiryTime: null,
    perishable: false,
    ...over,
  }
}

function commitment(over: Partial<Commitment> = {}): Commitment {
  return {
    matchId: 'm1',
    needId: 'low',
    resourceId: 'r1',
    quantity: 100,
    missionStatus: null,
    assigned: false,
    ...over,
  }
}

/** A routine need and a critical one competing for the same stock. */
const lowNeed = need({ id: 'low', severity: 'low', peopleAffected: 10 })
const criticalNeed = need({
  id: 'crit',
  severity: 'critical',
  peopleAffected: 5000,
  at: NEAR,
})

const run = (over: Partial<Parameters<typeof proposeReallocation>[0]> = {}) =>
  proposeReallocation({
    needs: [lowNeed, criticalNeed],
    resources: [resource()],
    commitments: [commitment()],
    now: NOW,
    ...over,
  })

describe('what may never be taken', () => {
  it('leaves a run a volunteer has accepted', () => {
    const check = isReleasable(commitment({ missionStatus: 'accepted' }), lowNeed)
    expect(check.releasable).toBe(false)
    expect(check.reason).toMatch(/accepted this run/i)
  })

  it('leaves a run already under way', () => {
    const check = isReleasable(commitment({ missionStatus: 'en_route' }), lowNeed)
    expect(check.releasable).toBe(false)
    expect(check.reason).toMatch(/on the way/i)
  })

  it('leaves a run with a named volunteer, even before they accept', () => {
    // They may already be planning their day around it.
    const check = isReleasable(
      commitment({ missionStatus: 'proposed', assigned: true }),
      lowNeed,
    )
    expect(check.releasable).toBe(false)
    expect(check.reason).toMatch(/named/i)
  })

  it('never takes from a life-critical need, however low its score', () => {
    const check = isReleasable(commitment(), need({ id: 'low', lifeCritical: true }))
    expect(check.releasable).toBe(false)
    expect(check.reason).toMatch(/life-critical/i)
  })

  it('refuses to release when the donor need is unknown', () => {
    /*
     * The dangerous case. If the need a commitment serves was not loaded, every
     * check that reads it silently passes: lifeCritical is undefined, so a
     * rescue need looks unprotected, and its priority reads as 0, so any move
     * clears the churn gate by a mile. Unknown must mean protected.
     */
    const check = isReleasable(commitment(), undefined)
    expect(check.releasable).toBe(false)
    expect(check.reason).toMatch(/could not be identified/i)
  })

  it('knows delivered stock is already gone', () => {
    for (const status of ['delivered', 'verified'] as const) {
      expect(isReleasable(commitment({ missionStatus: status }), lowNeed).releasable).toBe(false)
    }
  })

  it('does not double-release stock a failed run already returned', () => {
    for (const status of ['failed', 'cancelled'] as const) {
      expect(isReleasable(commitment({ missionStatus: status }), lowNeed).releasable).toBe(false)
    }
  })
})

describe('what may be taken', () => {
  it('releases stock reserved by a plan nobody has approved', () => {
    expect(isReleasable(commitment({ missionStatus: null }), lowNeed).releasable).toBe(true)
  })

  it('releases an unassigned proposed mission', () => {
    expect(
      isReleasable(commitment({ missionStatus: 'proposed', assigned: false }), lowNeed)
        .releasable,
    ).toBe(true)
  })
})

describe('proposing moves', () => {
  it('moves stock to the materially worse-off need', () => {
    const { moves } = run()
    expect(moves).toHaveLength(1)
    expect(moves[0]!.fromNeedId).toBe('low')
    expect(moves[0]!.toNeedId).toBe('crit')
    expect(moves[0]!.priorityGain).toBeGreaterThanOrEqual(MIN_PRIORITY_GAIN)
  })

  it('explains the move in terms a coordinator can check', () => {
    const { moves } = run()
    expect(moves[0]!.rationale).toMatch(/scores \d+ against \d+/)
    expect(moves[0]!.rationale).toMatch(/nothing has been promised to a volunteer/i)
  })

  it('proposes nothing when the gain is not material', () => {
    // Two needs of the same severity: shuffling between them is churn.
    const { moves } = run({
      needs: [lowNeed, need({ id: 'other', severity: 'low', peopleAffected: 12, at: NEAR })],
    })
    expect(moves).toEqual([])
  })

  it('proposes nothing when everything is already in motion', () => {
    const { moves, protectedCommitments } = run({
      commitments: [commitment({ missionStatus: 'en_route' })],
    })
    expect(moves).toEqual([])
    expect(protectedCommitments).toHaveLength(1)
  })

  it('reports what it left alone, so the decision can be overruled', () => {
    const { protectedCommitments } = run({
      commitments: [commitment({ missionStatus: 'accepted' })],
    })
    expect(protectedCommitments[0]).toMatchObject({ matchId: 'm1', needId: 'low' })
    expect(protectedCommitments[0]!.reason).toBeTruthy()
  })

  it('never proposes moving stock to the need already holding it', () => {
    const { moves } = run({
      needs: [criticalNeed],
      commitments: [commitment({ needId: 'crit' })],
    })
    expect(moves).toEqual([])
  })

  it('does not take the same commitment twice', () => {
    const { moves } = run({
      needs: [
        lowNeed,
        criticalNeed,
        need({ id: 'crit2', severity: 'critical', peopleAffected: 4000, at: NEAR }),
      ],
    })
    const donors = moves.map((m) => m.matchId)
    expect(new Set(donors).size).toBe(donors.length)
  })

  it('respects a custom gain threshold', () => {
    const strict = run({ minPriorityGain: 99 })
    expect(strict.moves).toEqual([])
  })
})

describe('honesty about what is left', () => {
  it('says a need is unserved when nothing can be moved', () => {
    const { stillUnserved } = proposeReallocation({
      needs: [criticalNeed],
      resources: [resource()],
      commitments: [commitment({ needId: 'low', missionStatus: 'en_route' })],
      now: NOW,
    })
    expect(stillUnserved.some((u) => u.needId === 'crit')).toBe(true)
    expect(stillUnserved[0]!.reason).toMatch(/already in motion/i)
  })

  it('writes nothing — a proposal is not an action', () => {
    const resources = [resource()]
    const before = JSON.stringify(resources)
    proposeReallocation({
      needs: [lowNeed, criticalNeed],
      resources,
      commitments: [commitment()],
      now: NOW,
    })
    expect(JSON.stringify(resources)).toBe(before)
  })

  it('is deterministic', () => {
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()))
  })
})
