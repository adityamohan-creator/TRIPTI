import { Card, CardBody } from '../components/ui/Card'
import { Skeleton } from '../components/ui/Skeleton'
import { ErrorState } from '../components/ui/States'
import { useAuth } from '../features/auth/auth-context'
import { ImpactSection } from '../features/impact/ImpactSection'
import { LiveIndicator } from '../components/ui/LiveIndicator'
import { useAsync } from '../hooks/useAsync'
import { useRealtime } from '../hooks/useRealtime'
import { get } from '../lib/api'
import { SEVERITIES, type Incident, type Severity } from '../types/api'

const SEVERITY_BAR: Record<Severity, string> = {
  low: 'bg-sev-low',
  medium: 'bg-sev-medium',
  high: 'bg-sev-high',
  critical: 'bg-sev-critical',
}

function Stat({
  label,
  value,
  hint,
  loading,
}: {
  label: string
  value: number | string
  hint?: string
  loading: boolean
}) {
  return (
    <Card>
      <CardBody>
        <p className="text-sm text-ink-2">{label}</p>
        {loading ? (
          <Skeleton className="mt-2 h-8 w-16" />
        ) : (
          <p className="mt-1 text-3xl font-semibold tracking-tight text-ink">{value}</p>
        )}
        {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
      </CardBody>
    </Card>
  )
}

export function Dashboard() {
  const { profile } = useAuth()
  const { data, loading, error, reload } = useAsync(
    () => get<{ incidents: Incident[] }>('/incidents'),
    [],
  )

  /*
   * `needs` too: the counts here are per incident, but an incident's status
   * moves when its needs are met, so a board watching only `incidents` misses
   * the change that actually mattered.
   */
  const status = useRealtime(['incidents', 'needs'], reload)

  const incidents = data?.incidents ?? []
  const open = incidents.filter((i) => i.status === 'open')
  const unlocated = incidents.filter((i) => i.lat == null)
  const peopleAffected = incidents.reduce((sum, i) => sum + (i.people_affected ?? 0), 0)

  const bySeverity = SEVERITIES.map((severity) => ({
    severity,
    count: incidents.filter((i) => i.severity === severity).length,
  }))
  const maxCount = Math.max(1, ...bySeverity.map((s) => s.count))

  const firstName = profile?.full_name?.split(' ')[0]

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          {firstName ? `Situation overview, ${firstName}` : 'Situation overview'}
        </h1>
        <p className="mt-1 text-sm text-ink-2">
          Live counts from the incident board, and what the response has confirmed
          delivered.
        </p>
        <LiveIndicator status={status} className="mt-2" />
      </div>

      {error ? (
        <ErrorState title="Could not load the board" message={error} onRetry={reload} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Incidents" value={incidents.length} loading={loading} />
            <Stat
              label="Awaiting triage"
              value={open.length}
              hint="Status is still open"
              loading={loading}
            />
            <Stat
              label="People affected"
              value={peopleAffected.toLocaleString()}
              hint="Sum of reported figures"
              loading={loading}
            />
            <Stat
              label="Not yet located"
              value={unlocated.length}
              hint="Excluded from matching until geocoded"
              loading={loading}
            />
          </div>

          <Card>
            <CardBody>
              <h2 className="text-sm font-semibold text-ink">By severity</h2>
              <dl className="mt-4 space-y-3">
                {bySeverity.map(({ severity, count }) => (
                  <div key={severity} className="flex items-center gap-3">
                    <dt className="w-20 shrink-0 text-sm capitalize text-ink-2">
                      {severity}
                    </dt>
                    <dd className="flex flex-1 items-center gap-3">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-sunken">
                        {loading ? null : (
                          <div
                            className={`h-full rounded-full ${SEVERITY_BAR[severity]}`}
                            style={{ width: `${(count / maxCount) * 100}%` }}
                          />
                        )}
                      </div>
                      <span className="w-8 text-right text-sm tabular-nums text-ink">
                        {loading ? '—' : count}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>

          {/*
            Impact loads on its own rather than as part of the board request: it
            is a heavier aggregate, and the situation counts above should not
            wait on a report to appear.
          */}
          <ImpactSection />
        </>
      )}
    </section>
  )
}
