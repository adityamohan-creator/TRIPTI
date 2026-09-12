import { useState } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Card, CardBody } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { useAsync } from '../../hooks/useAsync'
import { post } from '../../lib/api'
import { cn } from '../../lib/cn'
import type { FusionRun } from '../../types/api'
import { ClusterCard } from './ClusterCard'

/**
 * Crisis intelligence: many reports in, fused incidents out.
 *
 * Sits alongside the existing board rather than replacing any of it. The
 * incident list, the map and the dispatch board all still answer "what are we
 * doing about it"; this answers the question that comes before — "how many
 * separate things are actually happening here?"
 */

function Stat({
  label,
  value,
  tone,
  loading,
}: {
  label: string
  value: number | string
  tone?: 'critical' | 'high'
  loading: boolean
}) {
  return (
    <Card>
      <CardBody>
        <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">{label}</p>
        {loading ? (
          <Skeleton className="mt-2 h-8 w-14" />
        ) : (
          <p
            className={cn(
              'mt-1 text-3xl font-semibold tracking-tight tabular-nums',
              tone === 'critical' && 'text-sev-critical',
              tone === 'high' && 'text-sev-high',
              !tone && 'text-ink',
            )}
          >
            {value}
          </p>
        )}
      </CardBody>
    </Card>
  )
}

const SOURCES = [
  { key: 'demo' as const, label: 'Demo reports' },
  { key: 'incidents' as const, label: 'Live incidents' },
]

export function CrisisIntelligencePage() {
  const [source, setSource] = useState<'demo' | 'incidents'>('demo')

  const { data, loading, error, reload } = useAsync(
    () => post<FusionRun>('/fusion/cluster', { source }),
    [source],
  )

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            Crisis intelligence
          </h1>
          <p className="mt-1 text-sm text-ink-2">
            Reports describing the same incident are fused into one cluster, classified,
            and scored for urgency — with the reasoning and the source ids kept attached.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div
            role="group"
            aria-label="Report source"
            className="inline-flex rounded-control border border-line bg-sunken p-0.5"
          >
            {SOURCES.map((s) => (
              <button
                key={s.key}
                type="button"
                disabled={loading}
                aria-pressed={source === s.key}
                onClick={() => setSource(s.key)}
                className={cn(
                  'rounded-[0.3rem] px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
                  source === s.key
                    ? 'bg-raised text-ink shadow-solid'
                    : 'text-ink-2 hover:text-ink',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={reload} loading={loading}>
            Re-run
          </Button>
        </div>
      </div>

      {/*
        The disclaimer is rendered from the server's own response rather than
        from a local flag, so a synthetic run cannot be screenshotted without
        it. Nothing here has been trained or evaluated on TREC-IS data.
      */}
      {data?.disclaimer && (
        <Alert tone="warning" title="Synthetic demonstration data">
          {data.disclaimer}
        </Alert>
      )}

      {data && !data.evidenceAudit.ok && (
        <Alert tone="danger" title="Evidence check failed">
          {data.evidenceAudit.fabricated.length > 0
            ? `Cited identifiers that exist in no report: ${data.evidenceAudit.fabricated.join(', ')}.`
            : `Clusters citing no evidence: ${data.evidenceAudit.empty.join(', ')}.`}
        </Alert>
      )}

      {error ? (
        <ErrorState title="Could not run fusion" message={error} onRetry={reload} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Reports analysed"
              value={data?.reportsAnalysed ?? 0}
              loading={loading}
            />
            <Stat
              label="Clusters detected"
              value={data?.totals.clusters ?? 0}
              loading={loading}
            />
            <Stat
              label="Critical"
              value={data?.totals.critical ?? 0}
              tone="critical"
              loading={loading}
            />
            <Stat
              label="High priority"
              value={data?.totals.high ?? 0}
              tone="high"
              loading={loading}
            />
          </div>

          {loading && (
            <div className="space-y-4">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-48 w-full" />
              ))}
            </div>
          )}

          {!loading && data && data.clusters.length === 0 && (
            <EmptyState
              title="Nothing to fuse"
              description={
                source === 'incidents'
                  ? 'No incidents on the board carry report text yet. Try the demo reports to see how fusion behaves.'
                  : 'The demo corpus returned no clusters, which should not happen — check the fusion threshold.'
              }
            />
          )}

          {!loading && data && data.clusters.length > 0 && (
            <>
              <div className="space-y-4">
                {data.clusters.map((cluster) => (
                  <ClusterCard key={cluster.clusterId} cluster={cluster} />
                ))}
              </div>

              <p className="border-t border-line pt-3 text-xs text-ink-3">
                Grouped by <code className="font-mono">{data.provider}</code> — deterministic
                text, location and time similarity. The same reports always produce the same
                clusters. Categories are TRIPTI's own operational set, not TREC-IS labels.
              </p>
            </>
          )}
        </>
      )}
    </section>
  )
}
