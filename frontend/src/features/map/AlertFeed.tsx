import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState } from '../../components/ui/States'
import { cn } from '../../lib/cn'
import type { AlertLevel, DisasterAlert, FeedResponse } from '../../types/api'

/**
 * Live disaster alerts from outside this deployment.
 *
 * Every line here is copied from a named feed and links back to it. Nothing on
 * this panel was written by the software, and nothing on it is an incident —
 * an alert becomes work only when a coordinator reads it and files one. That
 * separation is the whole design: the world's alerts and this team's
 * commitments are different things, and merging them would let a global feed
 * silently create local obligations.
 */

const LEVEL_STYLE: Record<AlertLevel, string> = {
  red: 'bg-sev-critical-soft text-sev-critical border-sev-critical/30',
  orange: 'bg-sev-high-soft text-sev-high border-sev-high/30',
  green: 'bg-sev-low-soft text-sev-low border-sev-low/30',
}

function relative(iso: string): string {
  const minutes = (Date.now() - Date.parse(iso)) / 60_000
  if (!Number.isFinite(minutes)) return ''
  if (minutes < 60) return `${Math.max(1, Math.round(minutes))}m ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`
  return `${Math.round(minutes / (60 * 24))}d ago`
}

function AlertRow({ alert, near }: { alert: DisasterAlert; near: boolean }) {
  return (
    <li className="border-b border-line py-3 last:border-0 last:pb-0 first:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded-control border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide',
            LEVEL_STYLE[alert.level],
          )}
        >
          {alert.level}
        </span>
        <span className="text-xs font-medium capitalize text-ink-2">{alert.kind}</span>
        {near && (
          <span title="Within 250km of an incident already on your board">
            <Badge tone="warning">near active work</Badge>
          </span>
        )}
        <span className="ml-auto text-xs text-ink-3">{relative(alert.publishedAt)}</span>
      </div>

      <p className="mt-1.5 text-sm text-ink">{alert.title}</p>

      {alert.country && <p className="mt-0.5 text-xs text-ink-2">{alert.country}</p>}

      {/*
        The feed's own sentence, verbatim. The number behind it means people
        exposed to shaking on an earthquake and a death count on a flood, so it
        is never relabelled into a heading of our own.
      */}
      {alert.impactLabel && (
        <p className="mt-1 text-xs text-ink-3">{alert.impactLabel}</p>
      )}

      <a
        href={alert.url}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-1.5 inline-block text-xs font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
      >
        Read the {alert.source} report →
      </a>
    </li>
  )
}

export function AlertFeed({
  data,
  loading,
  error,
}: {
  data: FeedResponse | null
  loading: boolean
  error: string | null
}) {
  const near = new Set(data?.nearActive ?? [])

  // Worst first is how the API returns them; a coordinator scanning this reads
  // top down and should not have to hunt for the red one.
  const alerts = data?.alerts ?? []
  const shown = alerts.slice(0, 25)

  return (
    <Card>
      <CardHeader
        title="Global alerts"
        description={
          data
            ? `${data.source.toUpperCase()} · updated ${relative(data.fetchedAt)}`
            : 'Live feed of disasters reported worldwide.'
        }
      />
      <CardBody>
        {error && !data && (
          <Alert tone="warning" title="The alert feed is unreachable">
            {error} Everything else on this page is unaffected — alerts are context
            from outside, not part of your operation.
          </Alert>
        )}

        {data?.stale && (
          <Alert tone="warning" title="Showing the last copy that loaded">
            The feed could not be reached just now, so these alerts are from{' '}
            {relative(data.fetchedAt)} and may have moved on.
          </Alert>
        )}

        {loading && !data && (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        )}

        {data && shown.length === 0 && (
          <EmptyState
            title="No active alerts"
            description="The feed is reachable and reporting nothing at the moment."
          />
        )}

        {shown.length > 0 && (
          <>
            <ul className="max-h-[26rem] overflow-y-auto pr-1">
              {shown.map((alert) => (
                <AlertRow key={alert.id} alert={alert} near={near.has(alert.id)} />
              ))}
            </ul>
            {alerts.length > shown.length && (
              <p className="mt-3 border-t border-line pt-3 text-xs text-ink-3">
                Showing {shown.length} of {alerts.length}. The rest are lower-severity
                and available at the source.
              </p>
            )}
          </>
        )}
      </CardBody>
    </Card>
  )
}
