import { describe, expect, it } from 'vitest'
import { type EvidenceSource, auditEvidence, collectEvidence } from './evidence.js'

const sources = new Map<string, EvidenceSource>([
  ['inc-1', { reportId: 'inc-1', sourceId: 'REPORT-102' }],
  ['inc-2', { reportId: 'inc-2', sourceId: 'REPORT-109' }],
  ['inc-3', { reportId: 'inc-3', sourceId: null }],
])

describe('evidence is carried, never created', () => {
  it('preserves the external ids the reports arrived with', () => {
    const evidence = collectEvidence('CL-001', ['inc-1', 'inc-2'], sources)
    expect(evidence.evidenceIds).toEqual(['REPORT-102', 'REPORT-109'])
    expect(evidence.sourceIds).toEqual(['REPORT-102', 'REPORT-109'])
  })

  it('falls back to the internal id rather than inventing one', () => {
    /*
     * A report that originated inside TRIPTI has no external id. Citing its
     * own id is honest and resolves; minting "REPORT-003" would look identical
     * and point at nothing.
     */
    const evidence = collectEvidence('CL-002', ['inc-3'], sources)
    expect(evidence.evidenceIds).toEqual(['inc-3'])
    expect(evidence.sourceIds).toEqual([])
    expect(evidence.missingSourceIds).toEqual(['inc-3'])
  })

  it('never pads sourceIds to match the report count', () => {
    const evidence = collectEvidence('CL-003', ['inc-1', 'inc-3'], sources)
    expect(evidence.reportIds).toHaveLength(2)
    expect(evidence.sourceIds).toHaveLength(1)
    expect(evidence.evidenceIds).toHaveLength(2)
  })

  it('refuses a report it has never seen', () => {
    /*
     * Dropping it would understate what the cluster rests on, and an evidence
     * list that is quietly short is worse than an error — nobody inspects a
     * number that looks plausible.
     */
    expect(() => collectEvidence('CL-004', ['inc-1', 'ghost'], sources)).toThrow(/ghost/)
  })

  it('deduplicates and sorts, so output is stable', () => {
    const a = collectEvidence('CL-005', ['inc-2', 'inc-1', 'inc-1'], sources)
    const b = collectEvidence('CL-005', ['inc-1', 'inc-2'], sources)
    expect(a.reportIds).toEqual(['inc-1', 'inc-2'])
    expect(a.evidenceIds).toEqual(b.evidenceIds)
  })
})

describe('the audit', () => {
  const knownReports = new Set(['inc-1', 'inc-2', 'inc-3'])
  const knownSources = new Set(['REPORT-102', 'REPORT-109'])

  it('passes evidence built from real reports', () => {
    const evidence = [collectEvidence('CL-001', ['inc-1', 'inc-2'], sources)]
    expect(auditEvidence(evidence, knownReports, knownSources).ok).toBe(true)
  })

  it('can actually fail', () => {
    /*
     * A check that cannot fail proves nothing. This one is handed a fabricated
     * id directly, bypassing collectEvidence.
     */
    const result = auditEvidence(
      [
        {
          clusterId: 'CL-009',
          reportIds: ['inc-1'],
          sourceIds: ['INVENTED-1'],
          evidenceIds: ['INVENTED-1'],
          missingSourceIds: [],
        },
      ],
      knownReports,
      knownSources,
    )
    expect(result.ok).toBe(false)
    expect(result.fabricated).toEqual(['CL-009 -> INVENTED-1'])
  })

  it('flags a cluster citing nothing', () => {
    const result = auditEvidence(
      [{ clusterId: 'CL-010', reportIds: [], sourceIds: [], evidenceIds: [], missingSourceIds: [] }],
      knownReports,
      knownSources,
    )
    expect(result.ok).toBe(false)
    expect(result.empty).toEqual(['CL-010'])
  })

  it('accepts an internal id as evidence when there is no external one', () => {
    const evidence = [collectEvidence('CL-002', ['inc-3'], sources)]
    expect(auditEvidence(evidence, knownReports, knownSources).ok).toBe(true)
  })
})
