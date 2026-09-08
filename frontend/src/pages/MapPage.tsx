import { Alert } from '../components/ui/Alert'
import { Skeleton } from '../components/ui/Skeleton'
import { ErrorState } from '../components/ui/States'
import { CrisisMap, MapLegend, type MapIncident, type MapResource } from '../features/map/CrisisMap'
import { useAsync } from '../hooks/useAsync'
import { get } from '../lib/api'
import { minutesUntil } from '../lib/format'
import type { Incident, Resource } from '../types/api'

/** Anything due within this window is worth flagging on the map. */
const EXPIRING_SOON_MINUTES = 12 * 60

export function MapPage() {
  const incidents = useAsync(() => get<{ incidents: Incident[] }>('/incidents'), [])
  const resources = useAsync(() => get<{ resources: Resource[] }>('/resources?usable=true'), [])

  const loading = incidents.loading || resources.loading
  const error = incidents.error ?? resources.error

  const located: MapIncident[] = (incidents.data?.incidents ?? [])
    .filter((i) => i.lat != null && i.lon != null && i.status !== 'resolved')
    .map((i) => ({
      id: i.id,
      lat: i.lat!,
      lon: i.lon!,
      severity: i.severity,
      summary: i.summary,
      status: i.status,
      peopleAffected: i.people_affected,
    }))

  const supply: MapResource[] = (resources.data?.resources ?? [])
    .filter((r) => r.lat != null && r.lon != null)
    .map((r) => {
      const minutes = minutesUntil(r.expiry_time)
      return {
        id: r.id,
        lat: r.lat!,
        lon: r.lon!,
        label: r.label,
        kind: r.kind,
        availableQuantity: r.available_quantity,
        unit: r.unit,
        expiring: minutes !== null && minutes <= EXPIRING_SOON_MINUTES,
      }
    })

  const unlocatedIncidents = (incidents.data?.incidents ?? []).filter(
    (i) => i.lat == null && i.status !== 'resolved',
  ).length
  const unlocatedResources = (resources.data?.resources ?? []).filter(
    (r) => r.lat == null,
  ).length

  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Live map</h1>
        <p className="mt-1 text-sm text-ink-2">
          Open incidents and available supply. Anything without coordinates is missing
          from this picture — it is listed below rather than placed by guesswork.
        </p>
      </div>

      {error && !loading && (
        <ErrorState
          title="Could not load the map"
          message={error}
          onRetry={() => {
            incidents.reload()
            resources.reload()
          }}
        />
      )}

      {loading && <Skeleton className="h-[28rem] w-full" />}

      {!loading && !error && (
        <>
          <CrisisMap incidents={located} resources={supply} />
          <MapLegend />

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-2">
            <span>{located.length} incident(s) plotted</span>
            <span>{supply.length} resource(s) plotted</span>
          </div>

          {(unlocatedIncidents > 0 || unlocatedResources > 0) && (
            <Alert tone="warning" title="Not on the map">
              {unlocatedIncidents} incident(s) and {unlocatedResources} resource(s) have no
              coordinates, so they cannot be drawn — or matched. Locate them from the
              incident screen; coordinates are never inferred from the report text.
            </Alert>
          )}
        </>
      )}
    </section>
  )
}
