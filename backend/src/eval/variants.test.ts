import { describe, expect, it } from 'vitest'
import {
  applyTransform,
  decideVariant,
  digestOf,
  makeVariant,
  makeVariants,
} from './variants.js'

describe('the decision is a pure function of the id', () => {
  it('gives the same answer every time', () => {
    const a = decideVariant('trecis-2020A-00417')
    const b = decideVariant('trecis-2020A-00417')
    expect(a).toEqual(b)
  })

  it('does not depend on the message text', () => {
    // Only the id is hashed, so two different texts under one id decide alike.
    const first = makeVariant('m-1', 'Bridge down on the ring road')
    const second = makeVariant('m-1', 'Completely different words here')
    if (first && second) expect(first.transform).toBe(second.transform)
    else expect(first).toBe(second) // both null, consistently
  })

  it('hashes the salted id, not the bare id', () => {
    /*
     * The salt is part of the task definition. Dropping it would still be
     * deterministic — and would silently produce a different corpus from every
     * other implementation, which is the worst kind of wrong.
     */
    const { createHash } = require('node:crypto') as typeof import('node:crypto')
    const expected = createHash('sha256').update('20260911:m-1').digest()
    expect(digestOf('m-1').equals(expected)).toBe(true)
  })

  it('records the digest prefix so a decision can be audited', () => {
    const d = decideVariant('m-1')
    expect(d.digestPrefix).toMatch(/^[0-9a-f]{4}$/)
    expect(parseInt(d.digestPrefix.slice(0, 2), 16) % 10 < 6).toBe(d.selected)
  })
})

describe('selection rate', () => {
  it('selects roughly six messages in ten', () => {
    /*
     * Residues 0-5 of 256 bytes cover 156 values, so the expected rate is
     * 60.9%. A drifting rate is the signal that the byte-versus-hex-character
     * reading of h[0] has been changed.
     */
    const ids = Array.from({ length: 4000 }, (_, i) => `msg-${i}`)
    const selected = ids.filter((id) => decideVariant(id).selected).length
    const rate = selected / ids.length
    expect(rate).toBeGreaterThan(0.56)
    expect(rate).toBeLessThan(0.65)
  })

  it('spreads across all four transformations', () => {
    const ids = Array.from({ length: 4000 }, (_, i) => `msg-${i}`)
    const counts = new Map<string, number>()
    for (const id of ids) {
      const d = decideVariant(id)
      if (d.transform) counts.set(d.transform, (counts.get(d.transform) ?? 0) + 1)
    }
    expect(counts.size).toBe(4)
    for (const n of counts.values()) expect(n).toBeGreaterThan(400)
  })
})

describe('transformation 1 — lowercase, strip ASCII punctuation', () => {
  const t = (s: string) => applyTransform('lowercase-strip-punctuation', s)

  it('lowercases and removes ASCII punctuation', () => {
    expect(t('URGENT: Bridge down! (Sector-62)')).toBe('urgent bridge down sector62')
  })

  it('leaves non-ASCII punctuation alone', () => {
    /*
     * Crisis reports arrive in many scripts. Stripping the Devanagari danda
     * would change more than the task asks and would make output depend on the
     * runtime's Unicode tables rather than on the hash.
     */
    expect(t('सेक्टर 62 में पानी।')).toBe('सेक्टर 62 में पानी।')
  })

  it('does not change token count for a punctuation-free string', () => {
    expect(t('water needed now').split(' ')).toHaveLength(3)
  })
})

describe('transformation 2 — prepend and append', () => {
  const t = (s: string) => applyTransform('prepend-append', s)

  it('wraps the message', () => {
    expect(t('Roof collapsed')).toBe('Update: Roof collapsed Please verify.')
  })

  it('preserves the original text inside', () => {
    const original = 'Water level rising near the depot'
    expect(t(original)).toContain(original)
  })
})

describe('transformation 3 — drop the tail', () => {
  const t = (s: string) => applyTransform('truncate-tail', s)

  it('drops ceil(0.15n) tokens', () => {
    // 10 tokens, ceil(1.5) = 2 dropped, 8 kept.
    const text = Array.from({ length: 10 }, (_, i) => `w${i}`).join(' ')
    expect(t(text).split(' ')).toHaveLength(8)
  })

  it('keeps at least one token', () => {
    expect(t('flood')).toBe('flood')
    expect(t('flood here')).toBe('flood')
  })

  it('never returns empty', () => {
    for (const n of [1, 2, 3, 7, 20, 100]) {
      const text = Array.from({ length: n }, (_, i) => `t${i}`).join(' ')
      expect(t(text).length).toBeGreaterThan(0)
    }
  })

  it('collapses irregular whitespace rather than producing empty tokens', () => {
    expect(t('one   two\tthree\nfour five six seven')).not.toMatch(/\s\s/)
  })
})

describe('transformation 4 — positional swap', () => {
  const t = (s: string) => applyTransform('positional-swap', s)

  it('leaves short strings untouched', () => {
    const short = 'a'.repeat(39)
    expect(t(short)).toBe(short)
  })

  it('swaps at position 40 when both characters are alphanumeric', () => {
    const text = 'a'.repeat(40) + 'XY' + 'b'.repeat(20)
    // chars[40] = 'X', chars[41] = 'Y' -> swapped.
    expect(t(text).slice(40, 42)).toBe('YX')
  })

  it('refuses to swap across whitespace', () => {
    /*
     * A swap that moved a space would change the token count, turning a typo
     * model into a tokenisation change.
     */
    const text = 'a'.repeat(40) + ' Z' + 'b'.repeat(20)
    expect(t(text)).toBe(text)
  })

  it('swaps at every multiple of 40', () => {
    const text = ('a'.repeat(40) + 'XY').repeat(1) + 'a'.repeat(38) + 'PQ'
    const out = t(text)
    expect(out.slice(40, 42)).toBe('YX')
    expect(out.slice(80, 82)).toBe('QP')
  })

  it('never changes length', () => {
    const text = 'Report of flooding near the depot, water rising quickly on all sides now'
    expect(t(text)).toHaveLength(text.length)
  })
})

describe('variants as a corpus', () => {
  it('keeps the source id on every variant', () => {
    const messages = Array.from({ length: 50 }, (_, i) => ({
      id: `m-${i}`,
      text: `Report number ${i} about water and shelter needs in the affected area`,
    }))
    const variants = makeVariants(messages)
    expect(variants.length).toBeGreaterThan(0)
    for (const v of variants) {
      expect(v.sourceId).toMatch(/^m-\d+$/)
      expect(v.variantId).toBe(`${v.sourceId}::v1`)
    }
  })

  it('produces at most one variant per message', () => {
    const messages = Array.from({ length: 200 }, (_, i) => ({
      id: `m-${i}`,
      text: 'Water needed at the community centre as soon as possible please',
    }))
    const variants = makeVariants(messages)
    const sources = variants.map((v) => v.sourceId)
    expect(new Set(sources).size).toBe(sources.length)
  })

  it('is stable across runs', () => {
    const messages = Array.from({ length: 100 }, (_, i) => ({
      id: `m-${i}`,
      text: `Message ${i} reporting damage and requesting assistance urgently`,
    }))
    expect(JSON.stringify(makeVariants(messages))).toBe(
      JSON.stringify(makeVariants(messages)),
    )
  })

  it('returns null for a message the hash did not select', () => {
    const unselected = Array.from({ length: 200 }, (_, i) => `m-${i}`).find(
      (id) => !decideVariant(id).selected,
    )
    expect(unselected).toBeDefined()
    expect(makeVariant(unselected!, 'some text')).toBeNull()
  })
})
