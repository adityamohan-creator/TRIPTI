import { describe, expect, it } from 'vitest'
import {
  type MissionStatus,
  TERMINAL,
  allowedTransitions,
  canTransition,
  isTerminal,
  stockEffect,
  transitionsFrom,
} from './missionLifecycle.js'

const ALL: MissionStatus[] = [
  'proposed',
  'accepted',
  'en_route',
  'delivered',
  'verified',
  'failed',
  'cancelled',
]

describe('the graph', () => {
  it('lets every terminal status go nowhere', () => {
    for (const status of TERMINAL) {
      expect(transitionsFrom(status)).toEqual([])
    }
  })

  it('never proposes a transition to itself', () => {
    for (const status of ALL) {
      expect(transitionsFrom(status).some((t) => t.to === status)).toBe(false)
    }
  })

  it('gives every non-terminal status a way forward', () => {
    for (const status of ALL.filter((s) => !isTerminal(s))) {
      expect(transitionsFrom(status).length).toBeGreaterThan(0)
    }
  })

  it('names an actor for every transition', () => {
    for (const status of ALL) {
      for (const t of transitionsFrom(status)) {
        expect(t.actors.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('the happy path', () => {
  it('runs proposed → accepted → en_route → delivered → verified', () => {
    expect(canTransition('proposed', 'accepted', 'assignee').ok).toBe(true)
    expect(canTransition('accepted', 'en_route', 'assignee').ok).toBe(true)
    expect(canTransition('en_route', 'delivered', 'assignee').ok).toBe(true)
    expect(canTransition('delivered', 'verified', 'coordinator').ok).toBe(true)
  })
})

describe('illegal moves', () => {
  it('refuses to skip the middle of the run', () => {
    const check = canTransition('proposed', 'delivered', 'assignee')
    expect(check.ok).toBe(false)
    expect(check.reason).toMatch(/cannot go from proposed to delivered/i)
  })

  it('names what is possible instead', () => {
    expect(canTransition('proposed', 'verified', 'coordinator').reason).toMatch(
      /accepted, cancelled/,
    )
  })

  it('refuses to reopen a finished mission', () => {
    for (const status of TERMINAL) {
      const check = canTransition(status, 'accepted', 'coordinator')
      expect(check.ok).toBe(false)
      expect(check.reason).toMatch(/cannot change|already/i)
    }
  })

  it('refuses a move to the status it is already in', () => {
    expect(canTransition('en_route', 'en_route', 'assignee').reason).toMatch(/already/i)
  })
})

describe('who may do what', () => {
  it('does not let a volunteer verify their own delivery', () => {
    // A delivery confirmed only by the person who made it is not confirmed.
    const check = canTransition('delivered', 'verified', 'assignee')
    expect(check.ok).toBe(false)
    expect(check.reason).toMatch(/only a coordinator/i)
  })

  it('does not let a volunteer cancel a mission', () => {
    expect(canTransition('proposed', 'cancelled', 'assignee').ok).toBe(false)
  })

  it('lets a volunteer report that they cannot finish', () => {
    expect(canTransition('accepted', 'failed', 'assignee').ok).toBe(true)
    expect(canTransition('en_route', 'failed', 'assignee').ok).toBe(true)
  })

  it('offers a volunteer fewer options than a coordinator', () => {
    const volunteer = allowedTransitions('accepted', 'assignee')
    const coordinator = allowedTransitions('accepted', 'coordinator')
    expect(coordinator.length).toBeGreaterThan(volunteer.length)
  })
})

describe('stock effect', () => {
  it('consumes stock on delivery', () => {
    expect(stockEffect('delivered')).toBe('consume')
  })

  it('returns stock when the run does not happen', () => {
    expect(stockEffect('failed')).toBe('release')
    expect(stockEffect('cancelled')).toBe('release')
  })

  it('keeps holding stock while the run is live', () => {
    expect(stockEffect('accepted')).toBe('hold')
    expect(stockEffect('en_route')).toBe('hold')
  })

  it('does not double-count on verification', () => {
    // Delivery already consumed it; verifying must not consume it twice.
    expect(stockEffect('verified')).toBe('hold')
  })

  it('has an effect defined for every status', () => {
    for (const status of ALL) {
      expect(['consume', 'release', 'hold']).toContain(stockEffect(status))
    }
  })
})

describe('destructive moves are marked', () => {
  it('flags everything that releases stock', () => {
    for (const status of ALL) {
      for (const t of transitionsFrom(status)) {
        if (stockEffect(t.to) === 'release') expect(t.destructive).toBe(true)
      }
    }
  })
})
