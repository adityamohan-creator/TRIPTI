import { Alert } from '../components/ui/Alert'
import { LiveIndicator } from '../components/ui/LiveIndicator'
import { Skeleton } from '../components/ui/Skeleton'
import { ErrorState } from '../components/ui/States'
import { AlertFeed } from '../features/map/AlertFeed'
import {
  CrisisMap,
  MapLegend,
  type MapIncident,
  type MapResource,
  type MapAlert,
  type MapRoute,
  type MapVehicle,
} from '../features/map/CrisisMap'
import { useEffect, useRef } from 'react'
import { useAsync } from '../hooks/useAsync'
import { useRealtime } from '../hooks/useRealtime'
import { get } from '../lib/api'
import { minutesUntil } from '../lib/format'
import type { FeedResponse, Incident, Mission, Resource, Vehicle } from '../types/api'

/** Anything due within this window is worth flagging on the map. */
const EXPIRING_SOON_MINUTES = 12 * 60

export function MapPage() {
  const incidents = useAsync(() => get<{ incidents: Incident[] }>('/incidents'), [])
  const resources = useAsync(() => get<{ resources: Resource[] }>('/resources?usable=true'), [])
  const missions = useAsync(() => get<{ missions: Mission[] }>('/missions'), [])
  const vehicles = useAsync(() => get<{ vehicles: Vehicle[] }>('/vehicles'), [])

  /*
   * The external feed is loaded separately and never gates the map. It is
   * context from outside the operation — if GDACS is slow or down, the incident
   * picture must still draw.
   */
  const feed = useAsync(() => get<FeedResponse>('/feed'), [])

  const loading =
    incidents.loading || resources.loading || missions.loading || vehicles.loading
  const error = incidents.error ?? resources.error ?? missions.error ?? vehicles.error

  /*
   * Four independent reads, one refresh.
   *
   * A plain function rather than a useCallback: useRealtime keeps the callback
   * in a ref and resubscribes only when the table list changes, so a new
   * identity each render costs nothing. Memoising it here would only invite a
   * dependency array that has to be kept honest for no benefit.
   */
  const reloadAll = () => {
    incidents.reload()
    resources.reload()
    missions.reload()
    vehicles.reload()
  }

  /*
   * `needs` is in the list although the map never draws one: a need changing
   * is what makes an incident stop being unserved, and the marker colour
   * depends on it. Subscribing only to what is drawn leaves the map confidently
   * wrong.
   */
  const status = useRealtime(
    ['incidents', 'needs', 'resources', 'missions', 'vehicles'],
    reloadAll,
  )

  /*
   * Polled, not subscribed. The alert feed lives outside this database, so no
   * postgres change will ever announce it. Six minutes sits just past the
   * server's five-minute cache, so a refresh here usually costs nothing
   * upstream.
   */
  const reloadFeed = useRef(feed.reload)

  // Written in an effect, not during render: React reserves the right to run a
  // render twice or abandon it, and the interval only reads this much later.
  useEffect(() => {
    reloadFeed.current = feed.reload
  }, [feed.reload])

  useEffect(() => {
    const timer = window.setInterval(() => reloadFeed.current(), 6 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])

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

  const fleet: MapVehicle[] = (vehicles.data?.vehicles ?? [])
    .filter((v) => v.lat != null && v.lon != null)
    .map((v) => ({
      id: v.id,
      lat: v.lat!,
      lon: v.lon!,
      label: v.label,
      refrigerated: v.refrigerated,
      available: v.availability === 'available',
    }))

  // Only missions that were actually routed have a line to draw. A mission
  // without geometry is one the routing service could not solve — the dashed
  // fallback still shows the direct line so the run is visible either way.
  const routes: MapRoute[] = (missions.data?.missions ?? [])
    .filter((m) => m.route != null && m.status !== 'cancelled' && m.status !== 'failed')
    .map((m) => {
      const geometry = m.route!.geometry
      const points: [number, number][] = geometry
        ? geometry.coordinates.map(([lon, lat]) => [lat, lon] as [number, number])
        : ([
            m.resources?.lat != null && m.resources.lon != null
              ? [m.resources.lat, m.resources.lon]
              : null,
            m.needs?.incidents?.lat != null && m.needs.incidents.lon != null
              ? [m.needs.incidents.lat, m.needs.incidents.lon]
              : null,
          ].filter(Boolean) as [number, number][])

      return { id: m.id, points, estimated: m.route!.estimated || !geometry }
    })
    .filter((r) => r.points.length >= 2)

  // Only located alerts can be drawn; the panel lists all of them regardless.
  const alertMarkers: MapAlert[] = (feed.data?.alerts ?? [])
    .filter((a) => a.lat != null && a.lon != null)
    .map((a) => ({
      id: a.id,
      lat: a.lat!,
      lon: a.lon!,
      kind: a.kind,
      title: a.title,
      level: a.level,
      impactLabel: a.impactLabel,
      url: a.url,
    }))

  const unlocatedIncidents = (incidents.data?.incidents ?? []).filter(
    (i) => i.lat == null && i.status !== 'resolved',
  ).length
  const unlocatedResources = (resources.data?.resources ?? []).filter(
    (r) => r.lat == null,
  ).length

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Live map</h1>
          <p className="mt-1 text-sm text-ink-2">
            Open incidents and available supply. Anything without coordinates is missing
            from this picture — it is listed below rather than placed by guesswork.
          </p>
        </div>
        <LiveIndicator status={status} className="mt-1" />
      </div>

      {error && !loading && (
        <ErrorState title="Could not load the map" message={error} onRetry={reloadAll} />
      )}

      {loading && <Skeleton className="h-[28rem] w-full" />}

      {!loading && !error && (
        <>
          <CrisisMap
            incidents={located}
            resources={supply}
            vehicles={fleet}
            routes={routes}
            alerts={alertMarkers}
          />
          <MapLegend />

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-2">
            <span>{located.length} incident(s) plotted</span>
            <span>{supply.length} resource(s) plotted</span>
            <span>{fleet.length} vehicle(s) plotted</span>
            <span>{routes.length} route(s) drawn</span>
            <span>{alertMarkers.length} external alert(s)</span>
          </div>

          <AlertFeed data={feed.data} loading={feed.loading} error={feed.error} />

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
