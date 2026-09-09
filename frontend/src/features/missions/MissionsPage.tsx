import { useState } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Badge, StatusBadge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { useToast } from '../../components/ui/toast-context'
import { useAsync } from '../../hooks/useAsync'
import { get, post } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatCoords, formatQuantity, timeAgo } from '../../lib/format'
import type { CandidateResponse, Mission } from '../../types/api'
import { useAuth } from '../auth/auth-context'

export function MissionsPage() {
  const { profile } = useAuth()
  const [openId, setOpenId] = useState<string | null>(null)

  const { data, loading, error, reload } = useAsync(
    () => get<{ missions: Mission[] }>('/missions'),
    [],
  )

  const isStaff = profile?.role === 'coordinator' || profile?.role === 'admin'
  const missions = data?.missions ?? []
  const open = missions.find((m) => m.id === openId) ?? null

  if (open) {
    return (
      <MissionDetail
        mission={open}
        canDispatch={isStaff}
        onBack={() => setOpenId(null)}
        onChanged={reload}
      />
    )
  }

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Missions</h1>
        <p className="mt-1 text-sm text-ink-2">
          {profile?.role === 'volunteer'
            ? 'The runs assigned to you.'
            : 'Everything an approved plan has dispatched.'}
        </p>
      </div>

      {loading && <SkeletonList rows={4} />}
      {error && !loading && (
        <ErrorState title="Could not load missions" message={error} onRetry={reload} />
      )}

      {!loading && !error && missions.length === 0 && (
        <EmptyState
          title="No missions yet"
          description="Missions are created when a coordinator approves a response plan. Build one on the Planning screen."
        />
      )}

      {!loading && !error && missions.length > 0 && (
        <ul className="space-y-3">
          {missions.map((mission) => (
            <Card as="li" key={mission.id} className="transition-colors hover:border-line-strong">
              <button
                type="button"
                onClick={() => setOpenId(mission.id)}
                className="block w-full px-5 py-4 text-left"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={mission.status} kind="mission" />
                  {mission.assigned_to ? (
                    <Badge tone="brand">Assigned</Badge>
                  ) : (
                    <Badge tone="warning">Unassigned</Badge>
                  )}
                  <span className="ml-auto text-xs text-ink-3">
                    {timeAgo(mission.created_at)}
                  </span>
                </div>

                <p className="mt-2 text-sm font-medium text-ink">
                  {mission.resources?.label ?? 'Resource'} &rarr;{' '}
                  {mission.needs?.incidents?.summary ?? 'incident'}
                </p>

                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
                  <span>
                    {formatQuantity(mission.quantity, mission.resources?.unit ?? null)}
                  </span>
                  {mission.distance_km != null && <span>{mission.distance_km.toFixed(1)} km</span>}
                  {mission.route && (
                    <span>
                      {mission.route.durationMin} min
                      {mission.route.estimated && ' (estimated)'}
                    </span>
                  )}
                  {mission.need_priority != null && (
                    <span>priority {mission.need_priority.toFixed(0)}</span>
                  )}
                </div>
              </button>
            </Card>
          ))}
        </ul>
      )}
    </section>
  )
}

function MissionDetail({
  mission,
  canDispatch,
  onBack,
  onChanged,
}: {
  mission: Mission
  canDispatch: boolean
  onBack: () => void
  onChanged: () => void
}) {
  const toast = useToast()
  const [assigning, setAssigning] = useState<string | null>(null)
  const [routing, setRouting] = useState(false)

  const candidates = useAsync(
    () =>
      canDispatch
        ? get<CandidateResponse>(`/missions/${mission.id}/candidates`)
        : Promise.resolve({ candidates: [], excluded: [] } as CandidateResponse),
    [mission.id, canDispatch],
  )

  async function assign(volunteerId: string, vehicleId: string | null) {
    setAssigning(volunteerId)
    try {
      await post(`/missions/${mission.id}/assign`, {
        volunteer_id: volunteerId,
        vehicle_id: vehicleId,
      })
      toast.success('Volunteer assigned')
      onChanged()
      onBack()
    } catch (err) {
      toast.error('Could not assign', err instanceof Error ? err.message : '')
    } finally {
      setAssigning(null)
    }
  }

  async function buildRoute() {
    setRouting(true)
    try {
      const { route } = await post<{ route: { distanceKm: number; durationMin: number; estimated: boolean } }>(
        `/missions/${mission.id}/route`,
        {},
      )
      toast.success(
        'Route computed',
        `${route.distanceKm} km, ${route.durationMin} min${route.estimated ? ' (estimated)' : ''}`,
      )
      onChanged()
    } catch (err) {
      toast.error('Could not build a route', err instanceof Error ? err.message : '')
    } finally {
      setRouting(false)
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <button type="button" onClick={onBack} className="text-xs text-ink-2 hover:text-ink">
          &larr; All missions
        </button>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={mission.status} kind="mission" />
          {mission.assigned_to ? <Badge tone="brand">Assigned</Badge> : <Badge tone="warning">Unassigned</Badge>}
        </div>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-ink">
          {mission.resources?.label ?? 'Resource'} &rarr;{' '}
          {mission.needs?.incidents?.summary ?? 'incident'}
        </h1>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          {canDispatch && (
            <Card>
              <CardHeader
                title="Who should run this"
                description="Ranked by a tested function. The suggestion is advisory — you decide."
                action={
                  <Button size="sm" variant="secondary" onClick={buildRoute} loading={routing}>
                    {mission.route ? 'Recompute route' : 'Build route'}
                  </Button>
                }
              />
              <CardBody className="p-0">
                {candidates.loading && <div className="px-5 py-4"><SkeletonList rows={2} /></div>}

                {candidates.error && (
                  <div className="px-5 py-4">
                    <Alert tone="danger">{candidates.error}</Alert>
                  </div>
                )}

                {!candidates.loading && candidates.data?.candidates.length === 0 && (
                  <div className="space-y-3 px-5 py-4">
                    <Alert tone="warning" title="Nobody is eligible">
                      {candidates.data.excluded.length === 0
                        ? 'No volunteers have registered availability yet. Until someone does, there is nobody to rank.'
                        : 'Everyone available was ruled out — the reasons are below.'}
                    </Alert>
                    {candidates.data.excluded.map((item) => (
                      <p key={item.volunteerId} className="text-sm text-ink-2">
                        <span className="font-medium text-ink">{item.name ?? 'Volunteer'}</span> —{' '}
                        {item.reason}
                      </p>
                    ))}
                  </div>
                )}

                <ul className="divide-y divide-line">
                  {candidates.data?.candidates.map((candidate) => (
                    <li key={candidate.volunteerId} className="px-5 py-4">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-sm font-medium text-ink">
                          {candidate.volunteerName ?? 'Volunteer'}
                        </span>
                        {candidate.vehicleLabel && (
                          <Badge tone="neutral">{candidate.vehicleLabel}</Badge>
                        )}
                        <span className="ml-auto text-sm font-semibold tabular text-ink">
                          {candidate.score.toFixed(0)}
                          <span className="ml-1 text-xs font-normal text-ink-3">of 100</span>
                        </span>
                      </div>

                      <p className="mt-0.5 text-xs text-ink-2">
                        {candidate.distanceToPickupKm != null
                          ? `${candidate.distanceToPickupKm} km from pickup`
                          : 'Location not shared'}
                        {candidate.estimatedMinutes != null &&
                          ` · about ${candidate.estimatedMinutes} min round trip`}
                      </p>

                      <dl className="mt-2.5 space-y-1.5">
                        {candidate.terms.map((term) => (
                          <div key={term.key}>
                            <div className="flex items-baseline justify-between gap-3">
                              <dt className="text-xs text-ink-2">{term.label}</dt>
                              <dd className="text-xs tabular text-ink-3">
                                {term.points.toFixed(1)} of {(term.weight * 100).toFixed(0)}
                              </dd>
                            </div>
                            <div className="mt-0.5 h-0.5 overflow-hidden rounded-full bg-line">
                              <div
                                className={cn(
                                  'h-full rounded-full',
                                  term.normalised >= 0.66
                                    ? 'bg-positive'
                                    : term.normalised >= 0.33
                                      ? 'bg-warning'
                                      : 'bg-danger',
                                )}
                                style={{ width: `${Math.min(100, term.normalised * 100)}%` }}
                              />
                            </div>
                          </div>
                        ))}
                      </dl>

                      <Button
                        size="sm"
                        className="mt-3"
                        loading={assigning === candidate.volunteerId}
                        onClick={() => assign(candidate.volunteerId, candidate.vehicleId)}
                      >
                        Assign this volunteer
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="The run" />
            <CardBody className="space-y-2 text-sm">
              {/* Falling back to coordinates matters: the keyword extractor
                  never produces a place name, so a dash here would be the
                  normal case rather than the exception — and a volunteer needs
                  somewhere to drive to. */}
              <Row
                label="Collect"
                value={
                  mission.resources?.address ??
                  formatCoords(mission.resources?.lat ?? null, mission.resources?.lon ?? null) ??
                  mission.resources?.label ??
                  'Not located'
                }
              />
              <Row
                label="Deliver"
                value={
                  mission.needs?.incidents?.location_text ??
                  formatCoords(
                    mission.needs?.incidents?.lat ?? null,
                    mission.needs?.incidents?.lon ?? null,
                  ) ??
                  'Not located'
                }
              />
              <Row
                label="Load"
                value={formatQuantity(mission.quantity, mission.resources?.unit ?? null)}
              />
              <Row
                label="Distance"
                value={mission.distance_km != null ? `${mission.distance_km.toFixed(1)} km` : 'Not routed'}
              />
              <Row
                label="Duration"
                value={
                  mission.route
                    ? `${mission.route.durationMin} min${mission.route.estimated ? ' (estimated)' : ''}`
                    : 'Not routed'
                }
              />
            </CardBody>
          </Card>

          {mission.route?.estimated && (
            <Alert tone="warning" title="Estimated route">
              The routing service could not be reached, so this is a straight-line estimate
              with a road-winding factor. Treat the time as indicative.
            </Alert>
          )}
        </div>
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-ink-3">{label}</span>
      <span className="text-right text-sm text-ink">{value}</span>
    </div>
  )
}
