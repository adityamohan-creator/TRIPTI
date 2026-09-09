import { type FormEvent, useState } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Field'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { Table, Td, Th, Tr } from '../../components/ui/Table'
import { useToast } from '../../components/ui/toast-context'
import { useAsync } from '../../hooks/useAsync'
import { get, patch, post } from '../../lib/api'
import { useAuth } from '../auth/auth-context'
import {
  AVAILABILITY,
  VEHICLE_TYPES,
  type Availability,
  type Vehicle,
  type VehicleType,
} from '../../types/api'

/**
 * The fleet.
 *
 * Capacity and refrigeration are not decoration: the assigner treats a cold
 * load with no refrigerated vehicle as ineligible rather than merely worse, and
 * a vehicle too small for a load is excluded outright. An empty fleet is why
 * every match score currently reads "transport not assessed".
 */
export function VehiclesPage() {
  const { profile } = useAuth()
  const toast = useToast()
  const [editing, setEditing] = useState<Vehicle | null>(null)
  const [creating, setCreating] = useState(false)

  const { data, loading, error, reload } = useAsync(
    () => get<{ vehicles: Vehicle[] }>('/vehicles'),
    [],
  )

  const isStaff = profile?.role === 'coordinator' || profile?.role === 'admin'
  const vehicles = data?.vehicles ?? []

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Vehicles</h1>
          <p className="mt-1 text-sm text-ink-2">
            What the fleet can carry, and whether it can keep a load cold.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>Add vehicle</Button>
      </div>

      {loading && <SkeletonList rows={3} />}
      {error && !loading && (
        <ErrorState title="Could not load vehicles" message={error} onRetry={reload} />
      )}

      {!loading && !error && vehicles.length === 0 && (
        <EmptyState
          title="No vehicles registered"
          description="Until one exists, every match scores transport as 'not assessed' and no cold load can be assigned at all."
          action={<Button onClick={() => setCreating(true)}>Add the first vehicle</Button>}
        />
      )}

      {!loading && !error && vehicles.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>Vehicle</Th>
              <Th className="hidden sm:table-cell">Type</Th>
              <Th align="right">Capacity</Th>
              <Th>Cold</Th>
              <Th className="hidden lg:table-cell">Status</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {vehicles.map((vehicle) => (
              <Tr key={vehicle.id}>
                <Td className="max-w-[10rem] sm:max-w-xs">
                  <span className="block font-medium text-ink">{vehicle.label}</span>
                </Td>
                <Td className="hidden capitalize text-ink-2 sm:table-cell">{vehicle.type}</Td>
                <Td align="right" className="whitespace-nowrap">
                  {vehicle.capacity_units != null
                    ? `${vehicle.capacity_units.toLocaleString()} units`
                    : vehicle.capacity_kg != null
                      ? `${vehicle.capacity_kg.toLocaleString()} kg`
                      : '—'}
                </Td>
                <Td>
                  {vehicle.refrigerated ? (
                    <Badge tone="brand">Yes</Badge>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </Td>
                <Td className="hidden capitalize lg:table-cell">
                  <Badge tone={vehicle.availability === 'available' ? 'positive' : 'neutral'}>
                    {vehicle.availability}
                  </Badge>
                </Td>
                <Td align="right">
                  {(isStaff || vehicle.owner_id === profile?.id) && (
                    <Button variant="ghost" size="sm" onClick={() => setEditing(vehicle)}>
                      Edit
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      {(creating || editing) && (
        <VehicleForm
          vehicle={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => {
            toast.success(editing ? 'Vehicle updated' : 'Vehicle added')
            setCreating(false)
            setEditing(null)
            reload()
          }}
        />
      )}
    </section>
  )
}

function VehicleForm({
  vehicle,
  onClose,
  onSaved,
}: {
  vehicle: Vehicle | null
  onClose: () => void
  onSaved: () => void
}) {
  const editing = vehicle !== null
  const [label, setLabel] = useState(vehicle?.label ?? '')
  const [type, setType] = useState<VehicleType>(vehicle?.type ?? 'van')
  const [capacityUnits, setCapacityUnits] = useState(
    vehicle?.capacity_units != null ? String(vehicle.capacity_units) : '',
  )
  const [capacityKg, setCapacityKg] = useState(
    vehicle?.capacity_kg != null ? String(vehicle.capacity_kg) : '',
  )
  const [refrigerated, setRefrigerated] = useState(vehicle?.refrigerated ?? false)
  const [availability, setAvailability] = useState<Availability>(
    vehicle?.availability ?? 'available',
  )
  const [lat, setLat] = useState(vehicle?.lat != null ? String(vehicle.lat) : '')
  const [lon, setLon] = useState(vehicle?.lon != null ? String(vehicle.lon) : '')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const coordsIncomplete = (lat.trim() === '') !== (lon.trim() === '')

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (coordsIncomplete) {
      setError('Give both latitude and longitude, or neither.')
      return
    }

    const payload = {
      label: label.trim(),
      type,
      capacity_units: capacityUnits.trim() === '' ? null : Number(capacityUnits),
      capacity_kg: capacityKg.trim() === '' ? null : Number(capacityKg),
      refrigerated,
      availability,
      lat: lat.trim() === '' ? null : Number(lat),
      lon: lon.trim() === '' ? null : Number(lon),
    }

    setError(null)
    setSaving(true)
    try {
      if (editing) await patch(`/vehicles/${vehicle.id}`, payload)
      else await post('/vehicles', payload)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this vehicle.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Edit vehicle' : 'Add vehicle'}
        className="relative flex h-full w-full max-w-md flex-col border-l border-line bg-raised shadow-overlay"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">
            {editing ? 'Edit vehicle' : 'Add a vehicle'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-ink-3 transition-colors hover:text-ink"
          >
            &times;
          </button>
        </header>

        <form onSubmit={onSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
            {error && <Alert tone="danger">{error}</Alert>}

            <Input
              label="Label"
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Tempo — DL 1AB 2345"
            />

            <Select label="Type" value={type} onChange={(e) => setType(e.target.value as VehicleType)}>
              {VEHICLE_TYPES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Capacity (units)"
                type="number"
                min={0}
                value={capacityUnits}
                onChange={(e) => setCapacityUnits(e.target.value)}
                hint="Meals, crates, litres."
              />
              <Input
                label="Capacity (kg)"
                type="number"
                min={0}
                value={capacityKg}
                onChange={(e) => setCapacityKg(e.target.value)}
              />
            </div>
            <p className="-mt-2 text-xs text-ink-3">
              Leave blank if unknown — an unknown capacity never excludes the vehicle, it
              just cannot rule it in for a large load.
            </p>

            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={refrigerated}
                onChange={(e) => setRefrigerated(e.target.checked)}
                className="mt-0.5 size-4 rounded border-line-strong"
              />
              <span className="text-sm text-ink">
                Refrigerated
                <span className="mt-0.5 block text-xs text-ink-2">
                  Required for perishable loads. Without one, cooked food cannot be
                  assigned at all.
                </span>
              </span>
            </label>

            <Select
              label="Availability"
              value={availability}
              onChange={(e) => setAvailability(e.target.value as Availability)}
            >
              {AVAILABILITY.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Latitude"
                type="number"
                step="any"
                value={lat}
                onChange={(e) => setLat(e.target.value)}
                error={coordsIncomplete ? 'Needs a pair' : null}
              />
              <Input
                label="Longitude"
                type="number"
                step="any"
                value={lon}
                onChange={(e) => setLon(e.target.value)}
                error={coordsIncomplete ? 'Needs a pair' : null}
              />
            </div>
          </div>

          <footer className="flex justify-end gap-2 border-t border-line px-5 py-4">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? 'Save changes' : 'Add vehicle'}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  )
}
