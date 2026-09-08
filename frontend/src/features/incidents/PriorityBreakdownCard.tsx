import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { cn } from '../../lib/cn'
import type { PriorityBreakdown, PriorityLevel } from '../../types/api'

const LEVEL_LABEL: Record<PriorityLevel, string> = {
  routine: 'Routine',
  elevated: 'Elevated',
  high: 'High',
  critical: 'Critical',
}

const LEVEL_COLOR: Record<PriorityLevel, string> = {
  routine: 'text-sev-low',
  elevated: 'text-sev-medium',
  high: 'text-sev-high',
  critical: 'text-sev-critical',
}

const LEVEL_BAR: Record<PriorityLevel, string> = {
  routine: 'bg-sev-low',
  elevated: 'bg-sev-medium',
  high: 'bg-sev-high',
  critical: 'bg-sev-critical',
}

/**
 * Shows the score and the arithmetic that produced it.
 *
 * This is the whole reason allocation is deterministic rather than a model
 * output: a coordinator who disagrees with a ranking can see which term drove
 * it, and override the input that is wrong instead of arguing with a number.
 */
export function PriorityBreakdownCard({
  breakdown,
  title = 'Priority',
}: {
  breakdown: PriorityBreakdown
  title?: string
}) {
  return (
    <Card>
      <CardHeader
        title={title}
        description="Computed from stated facts by a tested function, not by a model."
        action={
          <div className="text-right">
            <span
              className={cn(
                'block text-2xl font-semibold tabular tracking-tight',
                LEVEL_COLOR[breakdown.level],
              )}
            >
              {breakdown.score.toFixed(0)}
            </span>
            <span className="text-xs text-ink-3">{LEVEL_LABEL[breakdown.level]}</span>
          </div>
        }
      />
      <CardBody className="space-y-3.5">
        {breakdown.terms.map((term) => (
          <div key={term.key}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13px] font-medium text-ink">{term.label}</span>
              <span className="shrink-0 text-xs text-ink-3 tabular">
                {term.points.toFixed(1)} of {(term.weight * 100).toFixed(0)}
              </span>
            </div>

            {/* The track is the term's maximum, so a short bar means "this
                counted for little", not "this value is small". */}
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-sunken">
              <div
                className={cn('h-full rounded-full', LEVEL_BAR[breakdown.level])}
                style={{ width: `${Math.max(0, Math.min(100, term.normalised * 100))}%` }}
              />
            </div>

            <p className="mt-1 text-xs text-ink-2">{term.detail}</p>
          </div>
        ))}
      </CardBody>
    </Card>
  )
}
