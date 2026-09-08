import { describe, expect, it } from 'vitest'
import {
  allocatable,
  availableQuantity,
  canReserve,
  hasCapacity,
  isExpired,
  minutesUntilExpiry,
} from './inventory.js'

const stocked = (quantity: number | null, reservedQuantity = 0) => ({
  quantity,
  reservedQuantity,
})

describe('availableQuantity', () => {
  it('subtracts what is already reserved', () => {
    expect(availableQuantity(stocked(100, 30))).toBe(70)
  })

  it('keeps an unmetered resource unmetered', () => {
    expect(availableQuantity(stocked(null, 5))).toBeNull()
  })

  it('never reports negative stock', () => {
    // The DB constraint should prevent this, but the engine must not produce a
    // negative number if a row ever gets there another way.
    expect(availableQuantity(stocked(10, 25))).toBe(0)
  })
})

describe('hasCapacity', () => {
  it('is false once everything is reserved', () => {
    expect(hasCapacity(stocked(50, 50))).toBe(false)
  })

  it('is true for an unmetered resource', () => {
    expect(hasCapacity(stocked(null, 99))).toBe(true)
  })
})

describe('allocatable', () => {
  it('clamps to what is left', () => {
    expect(allocatable(stocked(100, 80), 50)).toBe(20)
  })

  it('gives the full amount when there is enough', () => {
    expect(allocatable(stocked(100), 50)).toBe(50)
  })

  it('passes the request through when either side is unmetered', () => {
    expect(allocatable(stocked(null), 50)).toBe(50)
    expect(allocatable(stocked(100), null)).toBeNull()
  })
})

describe('canReserve', () => {
  it('rejects more than is available', () => {
    expect(canReserve(stocked(100, 60), 50)).toBe(false)
  })

  it('accepts exactly what is available', () => {
    expect(canReserve(stocked(100, 60), 40)).toBe(true)
  })

  it('rejects a negative amount', () => {
    expect(canReserve(stocked(100), -1)).toBe(false)
  })

  it('always accepts against an unmetered resource', () => {
    expect(canReserve(stocked(null, 0), 10_000)).toBe(true)
  })
})

describe('expiry', () => {
  const now = Date.parse('2026-09-08T12:00:00Z')

  it('reports minutes remaining', () => {
    expect(minutesUntilExpiry('2026-09-08T14:00:00Z', now)).toBe(120)
  })

  it('has no opinion about a resource that does not expire', () => {
    expect(minutesUntilExpiry(null, now)).toBeNull()
    expect(isExpired(null, now)).toBe(false)
  })

  it('treats the deadline itself as expired', () => {
    expect(isExpired('2026-09-08T12:00:00Z', now)).toBe(true)
  })

  it('is not expired while time remains', () => {
    expect(isExpired('2026-09-08T12:01:00Z', now)).toBe(false)
  })
})
