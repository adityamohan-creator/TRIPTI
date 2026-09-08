import { type FormEvent, useEffect, useRef, useState } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Input, Select, Textarea } from '../../components/ui/Field'
import { patch, post } from '../../lib/api'
import { toLocalInputValue } from '../../lib/format'
import { RESOURCE_KINDS, type Resource } from '../../types/api'

interface Props {
  /** Editing an existing listing, or null to create a new one. */
  resource: Resource | null
  onClose: () => void
  onSaved: () => void
}

/**
 * Create/edit panel for a resource. Slides in from the right on a wide screen
 * and covers the sheet on a narrow one, so the list stays in view while the
 * form is open.
 */
export function ResourceForm({ resource, onClose, onSaved }: Props) {
  const editing = resource !== null
  const firstFieldRef = useRef<HTMLInputElement>(null)

  const [label, setLabel] = useState(resource?.label ?? '')
  const [description, setDescription] = useState(resource?.description ?? '')
  const [kind, setKind] = useState<string>(resource?.kind ?? 'food')
  const [quantity, setQuantity] = useState(
    resource?.quantity != null ? String(resource.quantity) : '',
  )
  const [unit, setUnit] = useState(resource?.unit ?? '')
  const [address, setAddress] = useState(resource?.address ?? '')
  const [lat, setLat] = useState(resource?.lat != null ? String(resource.lat) : '')
  const [lon, setLon] = useState(resource?.lon != null ? String(resource.lon) : '')
  const [perishable, setPerishable] = useState(resource?.perishable ?? false)
  const [expiry, setExpiry] = useState(toLocalInputValue(resource?.expiry_time ?? null))

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    firstFieldRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const coordsIncomplete = (lat.trim() === '') !== (lon.trim() === '')

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (coordsIncomplete) {
      setError('Give both latitude and longitude, or neither.')
      return
    }
    if (perishable && !expiry) {
      setError('Perishable stock needs a collection deadline.')
      return
    }

    const payload = {
      label: label.trim(),
      description: description.trim() || null,
      quantity: quantity.trim() === '' ? null : Number(quantity),
      unit: unit.trim() || null,
      address: address.trim() || null,
      lat: lat.trim() === '' ? null : Number(lat),
      lon: lon.trim() === '' ? null : Number(lon),
      expiry_time: expiry ? new Date(expiry).toISOString() : null,
      perishable,
    }

    setSaving(true)
    try {
      if (editing) {
        await patch(`/resources/${resource.id}`, payload)
      } else {
        await post('/resources', { ...payload, kind })
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this resource.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Edit resource' : 'Add resource'}
        className="relative flex h-full w-full max-w-md flex-col border-l border-line bg-raised"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">
            {editing ? 'Edit resource' : 'Add a resource'}
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
              ref={firstFieldRef}
              label="Label"
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Cooked meals — Sector 18 kitchen"
            />

            {/* Kind decides which needs this can ever serve, so changing it on an
                existing listing would silently invalidate any match against it. */}
            <Select
              label="Kind"
              value={kind}
              disabled={editing}
              onChange={(e) => setKind(e.target.value)}
              hint={editing ? 'Kind cannot change after publishing.' : undefined}
            >
              {RESOURCE_KINDS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>

            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Quantity"
                type="number"
                min={0}
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                hint="Leave blank if unmetered."
              />
              <Input
                label="Unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="meals, litres"
              />
            </div>

            <Textarea
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Vegetarian, packed in trays of 20. Collection from the rear gate."
            />

            <Input
              label="Pickup address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />

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
            <p className="-mt-2 text-xs text-ink-3">
              Without coordinates this resource is excluded from automatic matching and
              has to be assigned by hand.
            </p>

            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={perishable}
                onChange={(e) => setPerishable(e.target.checked)}
                className="mt-0.5 size-4 rounded border-line-strong"
              />
              <span className="text-sm text-ink">
                Perishable
                <span className="mt-0.5 block text-xs text-ink-2">
                  Prepared food, medicine, anything with a hard deadline.
                </span>
              </span>
            </label>

            <Input
              label={perishable ? 'Use by' : 'Use by (optional)'}
              type="datetime-local"
              required={perishable}
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              hint="Matching prioritises stock that expires soonest."
            />
          </div>

          <footer className="flex justify-end gap-2 border-t border-line px-5 py-4">
            <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editing ? 'Save changes' : 'Publish resource'}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  )
}
