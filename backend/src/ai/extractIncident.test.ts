import { describe, expect, it } from 'vitest'
import { extractIncident } from './extractIncident.js'
import { fallbackExtract } from './fallback.js'
import {
  ExtractedIncident as ExtractedIncidentSchema,
  type ExtractedIncident,
  type ExtractionProvider,
} from './types.js'

const REPORT =
  'Flooding near Sector 62. Around 300 people are affected. Food and drinking water are urgently needed.'

function provider(
  behaviour: () => Promise<unknown>,
  name = 'test-provider',
): ExtractionProvider {
  return { name, extract: behaviour as ExtractionProvider['extract'] }
}

const validExtraction: ExtractedIncident = {
  summary: 'Flooding in Sector 62 affecting about 300 people.',
  category: 'flood',
  severity: 'high',
  location_text: 'Sector 62',
  people_affected: 300,
  needs: [
    { kind: 'food', quantity: 300, unit: 'meals', note: null },
    { kind: 'water', quantity: 600, unit: 'litres', note: null },
  ],
  vulnerable_groups: [],
  source_language: 'en',
  confidence: 0.82,
  unclear: [],
}

describe('extractIncident', () => {
  it('returns the provider result when the model succeeds', async () => {
    const result = await extractIncident(
      REPORT,
      provider(async () => validExtraction),
    )

    expect(result.source).toBe('model')
    expect(result.extraction.people_affected).toBe(300)
    expect(result.degradedReason).toBeUndefined()
  })

  it('falls back rather than throwing when the provider errors', async () => {
    const result = await extractIncident(
      REPORT,
      provider(async () => {
        throw new Error('503 upstream unavailable')
      }),
    )

    // Intake must keep working during an outage — the report is the point.
    expect(result.source).toBe('fallback')
    expect(result.degradedReason).toContain('503')
  })

  it('falls back when the provider returns something off-schema', async () => {
    const result = await extractIncident(
      REPORT,
      provider(async () => ({ severity: 'apocalyptic', needs: 'lots' })),
    )

    expect(result.source).toBe('fallback')
    expect(result.degradedReason).toMatch(/schema/i)
  })

  it('falls back when the provider returns nothing at all', async () => {
    const result = await extractIncident(
      REPORT,
      provider(async () => null),
    )
    expect(result.source).toBe('fallback')
  })

  it('never reports model confidence for a fallback result', async () => {
    const result = await extractIncident(
      REPORT,
      provider(async () => {
        throw new Error('down')
      }),
    )

    expect(result.extraction.confidence).toBe(0)
    expect(result.extraction.unclear.length).toBeGreaterThan(0)
  })
})

describe('fallbackExtract', () => {
  it('detects the kinds actually named in the report', () => {
    const kinds = fallbackExtract(REPORT).needs.map((n) => n.kind)
    expect(kinds).toContain('food')
    expect(kinds).toContain('water')
  })

  it('never invents a quantity from a keyword', () => {
    // "300 people" and "food" both appear, but nothing states how many meals.
    for (const need of fallbackExtract(REPORT).needs) {
      expect(need.quantity).toBeNull()
      expect(need.unit).toBeNull()
    }
  })

  it('never invents a headcount', () => {
    expect(fallbackExtract(REPORT).people_affected).toBeNull()
  })

  it('never guesses coordinates or a location', () => {
    expect(fallbackExtract(REPORT).location_text).toBeNull()
  })

  it('categorises from an explicit keyword', () => {
    expect(fallbackExtract('Major flooding downtown').category).toBe('flood')
    expect(fallbackExtract('Building fire on 4th street').category).toBe('fire')
  })

  it('falls back to other when nothing matches', () => {
    expect(fallbackExtract('Something has happened here').category).toBe('other')
  })

  it('raises severity only on explicit words, not on tone', () => {
    expect(fallbackExtract('HELP!!! PLEASE!!! ANYONE!!!').severity).toBe('medium')
    expect(fallbackExtract('Critical situation, people dying').severity).toBe('critical')
  })

  it('marks itself as unread so nobody mistakes it for extraction', () => {
    const result = fallbackExtract(REPORT)
    expect(result.confidence).toBe(0)
    expect(result.unclear.join(' ')).toMatch(/unavailable/i)
  })

  it('produces output that satisfies the same schema as the model path', () => {
    // Running with no API key is a supported mode, so the fallback's shape is
    // load-bearing: if it ever drifts from ExtractedIncident, every incident
    // created without a key would fail to insert.
    for (const text of [REPORT, '', 'Fire. Trapped people. Critical.']) {
      expect(ExtractedIncidentSchema.safeParse(fallbackExtract(text)).success).toBe(true)
    }
  })

  it('handles an empty report without throwing', () => {
    const result = fallbackExtract('')
    expect(result.needs).toEqual([])
    expect(result.summary).toBe('')
  })
})
