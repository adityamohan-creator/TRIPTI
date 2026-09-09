import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import { useEffect } from 'react'
import type { LatLngBoundsExpression, LatLngExpression } from 'leaflet'
import type { Severity } from '../../types/api'

/**
 * The operational picture.
 *
 * Uses circle markers rather than Leaflet's default pin images on purpose:
 * the default icons are PNG assets that break under bundlers, and circles can
 * carry the severity tokens directly — so a critical incident is the same red
 * here, on a badge, and in a chart.
 */

export interface MapIncident {
  id: string
  lat: number
  lon: number
  severity: Severity
  summary: string | null
  status: string
  peopleAffected: number | null
}

export interface MapResource {
  id: string
  lat: number
  lon: number
  label: string
  kind: string
  availableQuantity: number | null
  unit: string | null
  expiring: boolean
}

export interface MapVehicle {
  id: string
  lat: number
  lon: number
  label: string
  refrigerated: boolean
  available: boolean
}

export interface MapRoute {
  id: string
  /** [lat, lon] pairs. */
  points: [number, number][]
  /** True when this is a straight line, not a real road route. */
  estimated: boolean
}

const SEVERITY_COLOR: Record<Severity, string> = {
  low: 'var(--color-sev-low)',
  medium: 'var(--color-sev-medium)',
  high: 'var(--color-sev-high)',
  critical: 'var(--color-sev-critical)',
}

/** Delhi NCR — the region the demo data sits in. */
const FALLBACK_CENTER: LatLngExpression = [28.6139, 77.209]

function FitToContent({ points }: { points: [number, number][] }) {
  const map = useMap()

  useEffect(() => {
    if (points.length === 0) return
    if (points.length === 1) {
      map.setView(points[0]!, 12)
      return
    }
    // padding keeps markers off the edge, where popups would open off-screen.
    map.fitBounds(points as LatLngBoundsExpression, { padding: [40, 40], maxZoom: 14 })
  }, [map, points])

  return null
}

export function CrisisMap({
  incidents,
  resources,
  vehicles = [],
  routes = [],
  height = '28rem',
}: {
  incidents: MapIncident[]
  resources: MapResource[]
  /**
   * Vehicles, not volunteers. A vehicle's position is operational; a
   * volunteer's is where a person is standing, and plotting that for every
   * coordinator to see is a privacy decision nobody asked for. The assigner
   * already uses volunteer distance without exposing the location itself.
   */
  vehicles?: MapVehicle[]
  routes?: MapRoute[]
  height?: string
}) {
  const points: [number, number][] = [
    ...incidents.map((i) => [i.lat, i.lon] as [number, number]),
    ...resources.map((r) => [r.lat, r.lon] as [number, number]),
    ...vehicles.map((v) => [v.lat, v.lon] as [number, number]),
  ]

  return (
    <div
      className="overflow-hidden rounded-card border border-line"
      style={{ height }}
      // Leaflet measures its container, so it needs a real height before it
      // initialises — a percentage against an auto-height parent collapses to 0.
    >
      <MapContainer
        center={points[0] ?? FALLBACK_CENTER}
        zoom={11}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <FitToContent points={points} />

        {routes.map((route) => (
          <Polyline
            key={route.id}
            positions={route.points}
            pathOptions={{
              color: 'var(--color-brand-600)',
              weight: 3,
              opacity: 0.8,
              // A dashed line reads as "we do not know the roads", which is
              // exactly what a straight-line estimate means.
              dashArray: route.estimated ? '6 6' : undefined,
            }}
          />
        ))}

        {resources.map((resource) => (
          <CircleMarker
            key={resource.id}
            center={[resource.lat, resource.lon]}
            radius={7}
            pathOptions={{
              color: 'var(--color-brand-700)',
              fillColor: resource.expiring
                ? 'var(--color-warning)'
                : 'var(--color-brand-400)',
              fillOpacity: 0.9,
              weight: 2,
            }}
          >
            <Popup>
              <strong>{resource.label}</strong>
              <br />
              {resource.availableQuantity == null
                ? 'Unmetered'
                : `${resource.availableQuantity.toLocaleString()} ${resource.unit ?? ''} available`}
              <br />
              <span style={{ textTransform: 'capitalize' }}>{resource.kind}</span>
              {resource.expiring && <> · expiring soon</>}
            </Popup>
          </CircleMarker>
        ))}

        {vehicles.map((vehicle) => (
          <CircleMarker
            key={vehicle.id}
            center={[vehicle.lat, vehicle.lon]}
            radius={5}
            pathOptions={{
              color: 'var(--color-ink-2)',
              fillColor: vehicle.available ? 'var(--color-ink-2)' : 'transparent',
              fillOpacity: 1,
              weight: 2,
            }}
          >
            <Popup>
              <strong>{vehicle.label}</strong>
              <br />
              {vehicle.available ? 'Available' : 'Not available'}
              {vehicle.refrigerated && <> · refrigerated</>}
            </Popup>
          </CircleMarker>
        ))}

        {incidents.map((incident) => (
          <CircleMarker
            key={incident.id}
            center={[incident.lat, incident.lon]}
            // Incidents read larger than resources: demand is what a
            // coordinator scans for first.
            radius={11}
            pathOptions={{
              color: SEVERITY_COLOR[incident.severity],
              fillColor: SEVERITY_COLOR[incident.severity],
              fillOpacity: 0.35,
              weight: 3,
            }}
          >
            <Popup>
              <strong>{incident.summary ?? 'Incident'}</strong>
              <br />
              <span style={{ textTransform: 'capitalize' }}>
                {incident.severity} · {incident.status}
              </span>
              {incident.peopleAffected != null && (
                <>
                  <br />
                  {incident.peopleAffected.toLocaleString()} affected
                </>
              )}
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  )
}

export function MapLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-2">
      <span className="flex items-center gap-1.5">
        <span
          className="size-3 rounded-full border-2"
          style={{
            borderColor: 'var(--color-sev-critical)',
            background: 'color-mix(in oklab, var(--color-sev-critical) 35%, transparent)',
          }}
        />
        Incident, by severity
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="size-2.5 rounded-full border-2"
          style={{
            borderColor: 'var(--color-brand-700)',
            background: 'var(--color-brand-400)',
          }}
        />
        Resource
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="size-2.5 rounded-full border-2"
          style={{ borderColor: 'var(--color-brand-700)', background: 'var(--color-warning)' }}
        />
        Expiring soon
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="size-2 rounded-full border-2"
          style={{ borderColor: 'var(--color-ink-2)', background: 'var(--color-ink-2)' }}
        />
        Vehicle
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-6" style={{ background: 'var(--color-brand-600)' }} />
        Route
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="h-0.5 w-6"
          style={{
            backgroundImage:
              'repeating-linear-gradient(90deg, var(--color-brand-600) 0 4px, transparent 4px 8px)',
          }}
        />
        Estimated, roads unknown
      </span>
    </div>
  )
}
