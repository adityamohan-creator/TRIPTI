import { useState } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { Select } from '../../components/ui/Field'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { Table, Td, Th, Tr } from '../../components/ui/Table'
import { useToast } from '../../components/ui/toast-context'
import { LiveIndicator } from '../../components/ui/LiveIndicator'
import { useAsync } from '../../hooks/useAsync'
import { useRealtime } from '../../hooks/useRealtime'
import { api, get } from '../../lib/api'
import { formatQuantity, timeUntil } from '../../lib/format'
import {
  CAN_PUBLISH_RESOURCES,
  RESOURCE_KINDS,
  type Resource,
} from '../../types/api'
import { useAuth } from '../auth/auth-context'
import { ResourceForm } from './ResourceForm'

interface ResourceList {
  resources: Resource[]
  total: number
}

export function ResourcesPage() {
  const { profile } = useAuth()
  const toast = useToast()

  const [kind, setKind] = useState('')
  const [usableOnly, setUsableOnly] = useState(true)
  const [editing, setEditing] = useState<Resource | null>(null)
  const [creating, setCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Resource | null>(null)
  const [deleting, setDeleting] = useState(false)

  const query = new URLSearchParams()
  if (kind) query.set('kind', kind)
  if (usableOnly) query.set('usable', 'true')

  const { data, loading, error, reload } = useAsync(
    () => get<ResourceList>(`/resources?${query.toString()}`),
    [kind, usableOnly],
  )

  /*
   * `matches` alongside `resources`: reserving stock against a need does not
   * touch the resource row's quantity, it writes a match. A pool watching only
   * `resources` would keep showing units as free after a plan had promised
   * them.
   */
  const status = useRealtime(['resources', 'matches'], reload)

  const canPublish = profile != null && CAN_PUBLISH_RESOURCES.includes(profile.role)
  const isStaff = profile?.role === 'coordinator' || profile?.role === 'admin'

  function canEdit(resource: Resource) {
    return isStaff || resource.owner_id === profile?.id
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await api(`/resources/${pendingDelete.id}`, { method: 'DELETE' })
      toast.success('Resource removed', pendingDelete.label)
      setPendingDelete(null)
      reload()
    } catch (err) {
      toast.error(
        'Could not remove it',
        err instanceof Error ? err.message : 'Unknown error',
      )
    } finally {
      setDeleting(false)
    }
  }

  const resources = data?.resources ?? []

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Resources</h1>
          <p className="mt-1 text-sm text-ink-2">
            {isStaff || profile?.role === 'volunteer' || profile?.role === 'ngo'
              ? 'The supply pool the matching engine draws from.'
              : 'What you have listed, and what is still available on it.'}
          </p>
          <LiveIndicator status={status} className="mt-2" />
        </div>
        {canPublish && <Button onClick={() => setCreating(true)}>Add resource</Button>}
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="w-44">
          <Select label="Kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">All kinds</option>
            {RESOURCE_KINDS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 pb-0.5 text-sm text-ink-2">
          <input
            type="checkbox"
            checked={usableOnly}
            onChange={(e) => setUsableOnly(e.target.checked)}
            className="size-4 rounded border-line-strong"
          />
          Hide expired
        </label>
        {data && (
          <span className="ml-auto pb-1 text-xs text-ink-3 tabular">
            {resources.length} of {data.total}
          </span>
        )}
      </div>

      {loading && <SkeletonList rows={5} />}

      {error && !loading && (
        <ErrorState title="Could not load resources" message={error} onRetry={reload} />
      )}

      {!loading && !error && resources.length === 0 && (
        <EmptyState
          title={kind ? `No ${kind} listed` : 'Nothing in the pool yet'}
          description={
            canPublish
              ? 'Publish what you have available and it becomes matchable against incoming needs.'
              : 'Donors and partner organisations have not listed anything matching this filter.'
          }
          action={
            canPublish ? (
              <Button onClick={() => setCreating(true)}>Add the first resource</Button>
            ) : undefined
          }
        />
      )}

      {!loading && !error && resources.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>Resource</Th>
              {/* Narrow screens keep the four columns a coordinator scans for —
                  what it is, how much is left, and whether it is about to
                  expire. The rest reappear when there is room for them. */}
              <Th className="hidden sm:table-cell">Kind</Th>
              <Th align="right">Available</Th>
              <Th align="right" className="hidden lg:table-cell">
                Committed
              </Th>
              <Th>Deadline</Th>
              <Th className="hidden lg:table-cell">Location</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {resources.map((resource) => {
              const remaining = timeUntil(resource.expiry_time)
              return (
                <Tr key={resource.id}>
                  {/* Capped so a long label wraps instead of pushing the
                      quantity and deadline off a phone screen entirely. */}
                  <Td className="max-w-[9rem] sm:max-w-xs lg:max-w-sm">
                    <span className="block font-medium text-ink">{resource.label}</span>
                    {resource.description && (
                      <span className="mt-0.5 block truncate text-xs text-ink-2">
                        {resource.description}
                      </span>
                    )}
                  </Td>
                  <Td className="hidden sm:table-cell">
                    <span className="capitalize text-ink-2">{resource.kind}</span>
                  </Td>
                  <Td align="right" className="whitespace-nowrap">
                    {formatQuantity(resource.available_quantity, resource.unit)}
                  </Td>
                  <Td align="right" className="hidden lg:table-cell">
                    <span className={resource.reserved_quantity > 0 ? 'text-ink' : 'text-ink-3'}>
                      {resource.reserved_quantity > 0 ? resource.reserved_quantity : '—'}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {remaining ? (
                      // Expiry is the whole reason food rescue is time-critical,
                      // so it is stated plainly rather than softened.
                      <Badge tone={resource.expired ? 'danger' : 'warning'}>
                        {remaining}
                      </Badge>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </Td>
                  <Td className="hidden lg:table-cell">
                    {resource.lat == null ? (
                      <span className="text-warning">Not located</span>
                    ) : (
                      <span className="text-ink-2">
                        {resource.address ?? `${resource.lat.toFixed(3)}, ${resource.lon?.toFixed(3)}`}
                      </span>
                    )}
                  </Td>
                  <Td align="right">
                    {canEdit(resource) && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditing(resource)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPendingDelete(resource)}
                        >
                          Remove
                        </Button>
                      </div>
                    )}
                  </Td>
                </Tr>
              )
            })}
          </tbody>
        </Table>
      )}

      {(creating || editing) && (
        <ResourceForm
          resource={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => {
            toast.success(editing ? 'Resource updated' : 'Resource published')
            setCreating(false)
            setEditing(null)
            reload()
          }}
        />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove this resource?"
        description={
          <>
            <strong>{pendingDelete?.label}</strong> will no longer be matchable. If it is
            already committed to a mission, the request is refused rather than leaving a
            volunteer collecting nothing.
          </>
        }
        confirmLabel="Remove"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  )
}
