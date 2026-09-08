import { SeverityBadge, StatusBadge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { SkeletonList } from '../components/ui/Skeleton'
import { EmptyState, ErrorState } from '../components/ui/States'
import { useAuth } from '../features/auth/auth-context'
import { useAsync } from '../hooks/useAsync'
import { get } from '../lib/api'
import type { Incident } from '../types/api'

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function Incidents() {
  const { profile } = useAuth()
  const { data, loading, error, reload } = useAsync(
    () => get<{ incidents: Incident[] }>('/incidents'),
    [],
  )

  const isReporter = profile?.role === 'citizen' || profile?.role === 'donor'

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Incidents</h1>
        <p className="mt-1 text-sm text-ink-2">
          {isReporter
            ? 'Reports you have filed, and what has happened to them.'
            : 'Everything currently on the board, newest first.'}
        </p>
      </div>

      {loading && <SkeletonList rows={4} />}

      {error && !loading && (
        <ErrorState
          title="Could not load incidents"
          message={error}
          onRetry={reload}
        />
      )}

      {!loading && !error && data?.incidents.length === 0 && (
        <EmptyState
          title="Nothing on the board"
          description={
            isReporter
              ? 'You have not filed a report yet.'
              : 'No incidents have been reported. When one arrives it will appear here.'
          }
        />
      )}

      {!loading && !error && data && data.incidents.length > 0 && (
        <ul className="space-y-3">
          {data.incidents.map((incident) => (
            <Card as="li" key={incident.id}>
              {/* Not a link yet — the detail screen lands with triage in Phase 3. */}
              <div className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={incident.severity} />
                  <StatusBadge status={incident.status} />
                  {incident.category && (
                    <span className="text-xs font-medium capitalize text-ink-3">
                      {incident.category}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-ink-3">
                    {timeAgo(incident.created_at)}
                  </span>
                </div>

                <p className="mt-2 text-sm font-medium text-ink">
                  {incident.summary ?? incident.report_text.slice(0, 140)}
                </p>

                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
                  {incident.location_text && <span>{incident.location_text}</span>}
                  {incident.people_affected != null && (
                    <span>{incident.people_affected.toLocaleString()} affected</span>
                  )}
                  {incident.lat == null && (
                    // Needs without coordinates are excluded from the match plan,
                    // so this is operationally significant, not cosmetic.
                    <span className="text-warning">Not yet located</span>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </section>
  )
}
