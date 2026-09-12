import { classifyCluster } from '../ai/classifyReport.js'
import { DEMO_DISCLAIMER, DEMO_REPORTS } from '../ai/demoReports.js'
import { INFORMATION_TYPE_LABELS, type InformationType } from '../ai/informationTypes.js'
import { type Criticality, scoreCriticality } from '../engine/criticality.js'
import { type EvidenceSource, auditEvidence, collectEvidence } from '../engine/evidence.js'
import { type FusionOptions, type FusionReport, fuseReports } from '../engine/fusion.js'
import { notFound } from '../lib/errors.js'
import type { AuthUser } from '../middleware/auth.js'
import { admin } from '../supabase.js'

/**
 * Crisis report fusion, wired to the rest of TRIPTI.
 *
 * The engines it calls are pure — fusion, classification, criticality and
 * evidence all take facts and return decisions with no I/O of their own. This
 * layer does the loading, the persisting, and nothing else. That split is the
 * same one the matching engine uses, and for the same reason: a clustering a
 * coordinator disputes has to be reproducible from its inputs alone.
 */

export type ReportSource = 'incidents' | 'demo'

export interface FusionInputReport extends FusionReport {
  /** External id where the report came from outside. Null for TRIPTI's own. */
  sourceId: string | null
  peopleAffected: number | null
}

export interface ClusterResult {
  clusterId: string
  informationCategory: InformationType
  informationCategoryLabel: string
  categoryConfidence: number
  categoryTerms: string[]
  priorityScore: number
  priorityLevel: Criticality['level']
  priorityReason: string
  priorityFactors: Criticality['factors']
  evidenceIds: string[]
  reportIds: string[]
  reportCount: number
  /** Mean similarity of the links that formed it. Null for a single report. */
  cohesion: number | null
  reports: { id: string; sourceId: string | null; text: string; postedAt: string | null }[]
}

export interface FusionRunResult {
  source: ReportSource
  /** Present and non-null whenever synthetic data was used. */
  disclaimer: string | null
  reportsAnalysed: number
  clusters: ClusterResult[]
  totals: {
    clusters: number
    critical: number
    high: number
    medium: number
    low: number
  }
  evidenceAudit: { ok: boolean; fabricated: string[]; empty: string[] }
  provider: string
}

/** TRIPTI's own incidents, shaped for fusion. */
async function loadIncidents(limit: number): Promise<FusionInputReport[]> {
  const { data, error } = await admin
    .from('incidents')
    .select('id, report_text, summary, lat, lon, people_affected, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  return (data ?? []).map((row) => ({
    id: row.id as string,
    // The raw report, not the summary: fusion compares what people wrote.
    text: (row.report_text as string) ?? (row.summary as string) ?? '',
    postedAt: row.created_at ? Date.parse(row.created_at as string) : null,
    lat: row.lat as number | null,
    lon: row.lon as number | null,
    peopleAffected: row.people_affected as number | null,
    // An incident filed inside TRIPTI has no external id, and none is invented.
    sourceId: null,
  }))
}

/** The synthetic corpus. Always returned with its disclaimer attached. */
function loadDemo(): FusionInputReport[] {
  return DEMO_REPORTS.map((r) => ({
    id: r.sourceId,
    sourceId: r.sourceId,
    text: r.text,
    postedAt: Date.parse(r.postedAt),
    lat: r.lat,
    lon: r.lon,
    peopleAffected: r.peopleAffected,
  }))
}

export interface RunFusionOptions {
  source?: ReportSource
  limit?: number
  threshold?: number
}

/**
 * Runs the whole pipeline over a set of reports.
 *
 * Read-only with respect to TRIPTI's own tables: incidents are loaded and
 * never written. Clustering is a proposal about what is related, and turning
 * it into an operational fact is a coordinator's decision, not a side effect
 * of looking.
 */
export async function runFusion(options: RunFusionOptions = {}): Promise<FusionRunResult> {
  const source = options.source ?? 'demo'
  const reports =
    source === 'incidents' ? await loadIncidents(options.limit ?? 200) : loadDemo()

  const usable = reports.filter((r) => r.text.trim().length > 0)

  const fusionOptions: Partial<FusionOptions> =
    options.threshold != null ? { threshold: options.threshold } : {}

  const fused = fuseReports(usable, fusionOptions)

  const byId = new Map(usable.map((r) => [r.id, r]))
  const sources = new Map<string, EvidenceSource>(
    usable.map((r) => [r.id, { reportId: r.id, sourceId: r.sourceId }]),
  )

  const clusters: ClusterResult[] = []
  const totals = { clusters: 0, critical: 0, high: 0, medium: 0, low: 0 }

  for (const cluster of fused.clusters) {
    const members = cluster.reportIds.map((id) => byId.get(id)!)
    const texts = members.map((m) => m.text)

    const classification = classifyCluster(texts)

    /*
     * Headcount is the largest any single report states, not a sum. Four
     * reports of one flood of 400 people describe 400 people, and adding them
     * would claim 1,600 — the same double-counting the impact engine refuses.
     */
    const stated = members.map((m) => m.peopleAffected).filter((n): n is number => n != null)
    const peopleAffected = stated.length > 0 ? Math.max(...stated) : null

    const criticality = scoreCriticality({
      texts,
      informationType: classification.type,
      reportCount: members.length,
      peopleAffected,
      classificationConfidence: classification.confidence,
    })

    const evidence = collectEvidence(cluster.clusterId, cluster.reportIds, sources)

    totals.clusters += 1
    totals[criticality.level] += 1

    clusters.push({
      clusterId: cluster.clusterId,
      informationCategory: classification.type,
      informationCategoryLabel: INFORMATION_TYPE_LABELS[classification.type],
      categoryConfidence: classification.confidence,
      categoryTerms: classification.matchedTerms,
      priorityScore: criticality.score,
      priorityLevel: criticality.level,
      priorityReason: criticality.reason,
      priorityFactors: criticality.factors,
      evidenceIds: evidence.evidenceIds,
      reportIds: evidence.reportIds,
      reportCount: members.length,
      cohesion: cluster.cohesion,
      reports: members.map((m) => ({
        id: m.id,
        sourceId: m.sourceId,
        text: m.text,
        postedAt: m.postedAt ? new Date(m.postedAt).toISOString() : null,
      })),
    })
  }

  // Worst first: this list is read top down during an incident.
  const rank = { critical: 0, high: 1, medium: 2, low: 3 } as const
  clusters.sort(
    (a, b) => rank[a.priorityLevel] - rank[b.priorityLevel] || b.priorityScore - a.priorityScore,
  )

  const audit = auditEvidence(
    clusters.map((c) => ({
      clusterId: c.clusterId,
      reportIds: c.reportIds,
      sourceIds: [],
      evidenceIds: c.evidenceIds,
      missingSourceIds: [],
    })),
    new Set(usable.map((r) => r.id)),
    new Set(usable.map((r) => r.sourceId).filter((s): s is string => s != null)),
  )

  return {
    source,
    disclaimer: source === 'demo' ? DEMO_DISCLAIMER : null,
    reportsAnalysed: usable.length,
    clusters,
    totals,
    evidenceAudit: audit,
    provider: fused.provider,
  }
}

// ---------------------------------------------------------------- persistence

/**
 * Stores a run so its clusters can be revisited and linked to.
 *
 * Separate from `runFusion` on purpose: looking at a clustering must not
 * commit anyone to it. Nothing in TRIPTI's existing tables is touched — the
 * two tables written here reference incidents, and only ever by id.
 */
export async function saveRun(user: AuthUser, result: FusionRunResult) {
  const rows = result.clusters.map((c) => ({
    cluster_key: c.clusterId,
    information_category: c.informationCategory,
    priority_score: c.priorityScore,
    priority_level: c.priorityLevel,
    priority_reason: c.priorityReason,
    report_source: result.source,
    report_count: c.reportCount,
    cohesion: c.cohesion,
    created_by: user.id,
  }))

  const { data: saved, error } = await admin
    .from('report_clusters')
    .insert(rows)
    .select('id, cluster_key')

  if (error) throw error

  const byKey = new Map((saved ?? []).map((r) => [r.cluster_key as string, r.id as string]))

  const evidence = result.clusters.flatMap((c) =>
    c.reports.map((report) => ({
      cluster_id: byKey.get(c.clusterId)!,
      // Only a real incident id goes in the foreign key column; a demo report
      // is not an incident and must not pretend to be one.
      report_id: result.source === 'incidents' ? report.id : null,
      source_id: report.sourceId ?? report.id,
    })),
  )

  if (evidence.length > 0) {
    const { error: evidenceError } = await admin.from('report_evidence').insert(evidence)
    if (evidenceError) throw evidenceError
  }

  return { saved: saved?.length ?? 0 }
}

export async function listClusters(limit = 50) {
  const { data, error } = await admin
    .from('report_clusters')
    .select('*')
    .order('priority_score', { ascending: false })
    .limit(limit)

  if (error) throw error
  return { clusters: data ?? [] }
}

export async function getCluster(id: string) {
  const { data, error } = await admin
    .from('report_clusters')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw error
  if (!data) throw notFound('No such cluster')

  const { data: evidence, error: evidenceError } = await admin
    .from('report_evidence')
    .select('report_id, source_id')
    .eq('cluster_id', id)
    .order('source_id')

  if (evidenceError) throw evidenceError

  return {
    cluster: data,
    evidence: evidence ?? [],
    evidenceIds: (evidence ?? []).map((e) => e.source_id as string),
  }
}
