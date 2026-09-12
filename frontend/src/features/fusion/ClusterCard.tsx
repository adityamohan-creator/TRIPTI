import { useState } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Card, CardBody } from '../../components/ui/Card'
import { cn } from '../../lib/cn'
import type { CriticalityLevel, FusedCluster } from '../../types/api'

/**
 * One fused cluster.
 *
 * Built so a coordinator can disagree with it. The score, the category and the
 * grouping are all shown with the reasoning that produced them — the terms
 * that decided the category, the factors that added up to the score, and the
 * source ids the cluster rests on. A number without its working is not
 * something anyone can act on responsibly during an incident.
 */

const LEVEL_STYLE: Record<CriticalityLevel, string> = {
  critical: 'border-sev-critical/40 bg-sev-critical-soft text-sev-critical',
  high: 'border-sev-high/40 bg-sev-high-soft text-sev-high',
  medium: 'border-sev-medium/40 bg-sev-medium-soft text-sev-medium',
  low: 'border-sev-low/40 bg-sev-low-soft text-sev-low',
}

const BAR: Record<CriticalityLevel, string> = {
  critical: 'bg-sev-critical',
  high: 'bg-sev-high',
  medium: 'bg-sev-medium',
  low: 'bg-sev-low',
}

export function ClusterCard({ cluster }: { cluster: FusedCluster }) {
  const [showReports, setShowReports] = useState(false)

  return (
    <Card>
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold text-ink-2">
                {cluster.clusterId}
              </span>
              <Badge tone="brand">{cluster.informationCategoryLabel}</Badge>
              {cluster.reportCount > 1 && (
                <span className="text-xs text-ink-3">
                  {cluster.reportCount} reports fused
                </span>
              )}
            </div>

            {cluster.categoryTerms.length > 0 && (
              /*
               * The terms that decided the category. Shown because a
               * classification a coordinator cannot interrogate is one they
               * have to either accept or ignore wholesale.
               */
              <p className="mt-1.5 text-xs text-ink-3">
                Matched on{' '}
                {cluster.categoryTerms.slice(0, 5).map((term, i) => (
                  <span key={term}>
                    {i > 0 && ', '}
                    <code className="rounded-sm bg-sunken px-1 py-0.5 font-mono">{term}</code>
                  </span>
                ))}
              </p>
            )}
          </div>

          <div
            className={cn(
              'shrink-0 rounded-control border px-3 py-1.5 text-center',
              LEVEL_STYLE[cluster.priorityLevel],
            )}
          >
            <div className="text-lg leading-none font-semibold tabular-nums">
              {cluster.priorityScore}
              <span className="text-xs font-normal opacity-70">/100</span>
            </div>
            <div className="mt-0.5 text-[0.65rem] font-semibold tracking-wide uppercase">
              {cluster.priorityLevel}
            </div>
          </div>
        </div>

        <div className="h-1 overflow-hidden rounded-full bg-sunken">
          <div
            className={cn('h-full rounded-full', BAR[cluster.priorityLevel])}
            style={{ width: `${cluster.priorityScore}%` }}
          />
        </div>

        <p className="text-sm text-ink-2">{cluster.priorityReason}</p>

        {/* What the score is made of, so the number can be argued with. */}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {cluster.priorityFactors.map((factor) => (
            <span key={factor.key} className="text-xs text-ink-3" title={factor.detail}>
              {factor.label}{' '}
              <span className="font-medium tabular-nums text-ink-2">+{factor.points}</span>
            </span>
          ))}
        </div>

        <div className="border-t border-line pt-3">
          <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">
            Evidence
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {cluster.evidenceIds.map((id) => (
              <code
                key={id}
                className="rounded-control border border-line bg-sunken px-1.5 py-0.5 font-mono text-xs text-ink-2"
              >
                {id}
              </code>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-3">
            Carried from the reports themselves — no identifier here was generated.
          </p>
        </div>

        <div>
          <button
            type="button"
            onClick={() => setShowReports((v) => !v)}
            className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-action focus-visible:outline-none dark:text-brand-300"
          >
            {showReports ? 'Hide reports' : `View ${cluster.reportCount} report${cluster.reportCount === 1 ? '' : 's'}`}
          </button>

          {showReports && (
            <ul className="mt-3 space-y-2">
              {cluster.reports.map((report) => (
                <li
                  key={report.id}
                  className="rounded-control border border-line bg-sunken px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-xs text-ink-3">
                      {report.sourceId ?? report.id}
                    </code>
                    {report.postedAt && (
                      <span className="text-xs text-ink-3">
                        {new Date(report.postedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-ink-2">{report.text}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
