/**
 * Keeping the trail from a cluster back to the reports that made it.
 *
 * The single rule: **an id is carried, never created.** Every identifier in a
 * cluster's evidence came in on a report. Nothing here derives one, formats
 * one, or invents one to fill a gap.
 *
 * That matters more here than anywhere else in this feature. A cluster asserts
 * that several separate reports describe one incident, and a coordinator acting
 * on it is entitled to go and read those reports. An id that does not resolve
 * turns a checkable claim into an unfalsifiable one, and the failure is silent
 * — a fabricated id looks exactly like a real one until somebody tries it.
 */

export interface EvidenceSource {
  /** The report's id inside TRIPTI. */
  reportId: string
  /**
   * The identifier this report arrived with from outside, where there was one
   * — a feed's own id, a dataset message id. Null when the report originated
   * here.
   */
  sourceId: string | null
}

export interface ClusterEvidence {
  clusterId: string
  /** Every report id in the cluster, sorted for stable output. */
  reportIds: string[]
  /** External ids, where they exist. Never padded to match reportIds. */
  sourceIds: string[]
  /**
   * What a reader should cite. External id where known, internal id otherwise
   * — so the list always resolves to something real.
   */
  evidenceIds: string[]
  /** Reports carrying no external id. Reported, not hidden. */
  missingSourceIds: string[]
}

/**
 * Builds the evidence for one cluster.
 *
 * Throws on a report id that is not in the cluster rather than dropping it.
 * Silently discarding evidence would understate what a cluster rests on, and
 * an evidence list that is quietly short is worse than an error — nobody
 * inspects a number that looks plausible.
 */
export function collectEvidence(
  clusterId: string,
  reportIds: string[],
  sources: Map<string, EvidenceSource>,
): ClusterEvidence {
  const ids = [...new Set(reportIds)].sort()

  const sourceIds: string[] = []
  const evidenceIds: string[] = []
  const missingSourceIds: string[] = []

  for (const reportId of ids) {
    const source = sources.get(reportId)

    if (!source) {
      throw new Error(
        `Evidence for ${clusterId} names report ${reportId}, which is not in the corpus. ` +
          'An id that does not resolve makes the cluster uncheckable.',
      )
    }

    if (source.sourceId) {
      sourceIds.push(source.sourceId)
      evidenceIds.push(source.sourceId)
    } else {
      missingSourceIds.push(reportId)
      evidenceIds.push(reportId)
    }
  }

  return { clusterId, reportIds: ids, sourceIds, evidenceIds, missingSourceIds }
}

export interface EvidenceAudit {
  ok: boolean
  /** Cited ids that exist in no report. Should always be empty. */
  fabricated: string[]
  /** Clusters citing nothing at all. */
  empty: string[]
}

/**
 * Checks evidence against the corpus it claims to come from.
 *
 * Worth running even though `collectEvidence` cannot produce a bad id: the
 * check is cheap, and the guarantee is only as good as the last person to edit
 * the code above. A test that can never fail proves nothing, so this exists to
 * be able to fail.
 */
export function auditEvidence(
  evidence: ClusterEvidence[],
  knownReportIds: Set<string>,
  knownSourceIds: Set<string>,
): EvidenceAudit {
  const fabricated: string[] = []
  const empty: string[] = []

  for (const entry of evidence) {
    if (entry.evidenceIds.length === 0) empty.push(entry.clusterId)

    for (const id of entry.evidenceIds) {
      if (!knownReportIds.has(id) && !knownSourceIds.has(id)) {
        fabricated.push(`${entry.clusterId} -> ${id}`)
      }
    }
  }

  return { ok: fabricated.length === 0 && empty.length === 0, fabricated, empty }
}
