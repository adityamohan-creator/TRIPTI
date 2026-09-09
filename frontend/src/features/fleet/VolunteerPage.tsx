import { type FormEvent, useState } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Input, Select } from '../../components/ui/Field'
import { SkeletonList } from '../../components/ui/Skeleton'
import { ErrorState } from '../../components/ui/States'
import { useToast } from '../../components/ui/toast-context'
import { useAsync } from '../../hooks/useAsync'
import { api, get } from '../../lib/api'
import { cn } from '../../lib/cn'
import {
  AVAILABILITY,
  COMMON_SKILLS,
  type Availability,
  type Vehicle,
  type Volunteer,
} from '../../types/api'

/**
 * A volunteer's own record.
 *
 * Self-service on purpose: availability is something only the person knows, and
 * a coordinator marking someone "available" on their behalf is how a mission
 * gets assigned to someone asleep. Coordinators read this roster; they do not
 * write to it.
 */
export function VolunteerPage() {
  const toast = useToast()
  const me = useAsync(() => get<{ volunteer: Volunteer | null }>('/volunteers/me'), [])
  const vehicles = useAsync(() => get<{ vehicles: Vehicle[] }>('/vehicles'), [])

  if (me.loading) return <SkeletonList rows={3} />
  if (me.error) {
    return <ErrorState title="Could not load your record" message={me.error} onRetry={me.reload} />
  }

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Your availability</h1>
        <p className="mt-1 text-sm text-ink-2">
          Coordinators can only offer you a mission when this says you are available. Nobody
          sets it for you.
        </p>
      </div>

      <VolunteerForm
        key={me.data?.volunteer?.updated_at ?? 'new'}
        volunteer={me.data?.volunteer ?? null}
        vehicles={vehicles.data?.vehicles ?? []}
        onSaved={() => {
          toast.success('Availability saved')
          me.reload()
        }}
      />
    </section>
  )
}

function VolunteerForm({
  volunteer,
  vehicles,
  onSaved,
}: {
  volunteer: Volunteer | null
  vehicles: Vehicle[]
  onSaved: () => void
}) {
  const toast = useToast()
  const [availability, setAvailability] = useState<Availability>(
    volunteer?.availability ?? 'offline',
  )
  const [skills, setSkills] = useState<string[]>(volunteer?.skills ?? [])
  const [vehicleId, setVehicleId] = useState(volunteer?.vehicle_id ?? '')
  const [maxMissions, setMaxMissions] = useState(String(volunteer?.max_concurrent_missions ?? 1))
  const [lat, setLat] = useState(volunteer?.lat != null ? String(volunteer.lat) : '')
  const [lon, setLon] = useState(volunteer?.lon != null ? String(volunteer.lon) : '')
  const [notes, setNotes] = useState(volunteer?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const coordsIncomplete = (lat.trim() === '') !== (lon.trim() === '')

  function toggleSkill(skill: string) {
    setSkills((current) =>
      current.includes(skill) ? current.filter((s) => s !== skill) : [...current, skill],
    )
  }

  /** Uses the browser's own geolocation, with consent, rather than guessing. */
  function useMyLocation() {
    if (!navigator.geolocation) {
      toast.error('This browser cannot share a location')
      return
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLat(position.coords.latitude.toFixed(6))
        setLon(position.coords.longitude.toFixed(6))
        toast.success('Location filled in', 'Save to share it with coordinators.')
      },
      () => toast.error('Could not read your location', 'Enter it by hand, or leave it blank.'),
      { timeout: 8000 },
    )
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (coordsIncomplete) {
      setError('Give both latitude and longitude, or neither.')
      return
    }

    setError(null)
    setSaving(true)
    try {
      await api('/volunteers/me', {
        method: 'PUT',
        body: JSON.stringify({
          availability,
          skills,
          vehicle_id: vehicleId || null,
          max_concurrent_missions: Number(maxMissions),
          lat: lat.trim() === '' ? null : Number(lat),
          lon: lon.trim() === '' ? null : Number(lon),
          notes: notes.trim() || null,
        }),
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Volunteer record"
        action={
          <Badge tone={availability === 'available' ? 'positive' : 'neutral'} className="capitalize">
            {availability}
          </Badge>
        }
      />
      <CardBody>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {error && <Alert tone="danger">{error}</Alert>}

          <Select
            label="Availability"
            value={availability}
            onChange={(e) => setAvailability(e.target.value as Availability)}
            hint="Offline keeps you out of every assignment suggestion."
          >
            {AVAILABILITY.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>

          <fieldset>
            <legend className="text-[13px] font-medium text-ink">Skills</legend>
            <p className="mt-0.5 text-xs text-ink-3">
              A mission that requires a skill you do not hold will not be offered to you.
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {COMMON_SKILLS.map((skill) => {
                const on = skills.includes(skill)
                return (
                  <button
                    key={skill}
                    type="button"
                    onClick={() => toggleSkill(skill)}
                    aria-pressed={on}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs transition-colors',
                      on
                        ? 'border-brand-600 bg-brand-100 text-brand-800 dark:border-brand-400 dark:bg-brand-900/40 dark:text-brand-100'
                        : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
                    )}
                  >
                    {skill}
                  </button>
                )
              })}
            </div>
          </fieldset>

          <Select
            label="Your vehicle"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            hint={
              vehicles.length === 0
                ? 'None registered yet — add one on the Vehicles screen.'
                : 'Used first when a mission needs transport.'
            }
          >
            <option value="">None</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicle.label}
                {vehicle.refrigerated ? ' (refrigerated)' : ''}
              </option>
            ))}
          </Select>

          <Input
            label="Missions at once"
            type="number"
            min={1}
            max={10}
            value={maxMissions}
            onChange={(e) => setMaxMissions(e.target.value)}
            hint="You will not be suggested beyond this."
          />

          <div>
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
            <div className="mt-2 flex items-center gap-3">
              <Button type="button" variant="secondary" size="sm" onClick={useMyLocation}>
                Use my location
              </Button>
              <span className="text-xs text-ink-3">
                Optional. Without it you are ranked neutrally on distance, not excluded.
              </span>
            </div>
          </div>

          <Input
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            hint="Anything a coordinator should know — hours you can drive, areas you know."
          />

          <Button type="submit" loading={saving}>
            Save availability
          </Button>
        </form>
      </CardBody>
    </Card>
  )
}
