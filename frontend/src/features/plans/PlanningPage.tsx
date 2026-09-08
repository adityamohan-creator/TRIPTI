import { useState } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { useToast } from '../../components/ui/toast-context'
import { useAsync } from '../../hooks/useAsync'
import { get, post } from '../../lib/api'
import { formatQuantity, timeUntil } from '../../lib/format'
import type { PlanDetail, PlanPreview, ResponsePlan } from '../../types/api'
import { MatchRationale } from './MatchRationale'

export function PlanningPage() {
  const toast = useToast()
  const [creating, setCreating] = useState(false)
  const [openPlan, setOpenPlan] = useState<PlanDetail | null>(null)
  const [confirm, setConfirm] = useState<'approve' | 'discard' | null>(null)
  const [deciding, setDeciding] = useState(false)

  const preview = useAsync(() => get<PlanPreview>('/plans/preview'), [])
  const plans = useAsync(() => get<{ plans: ResponsePlan[] }>('/plans'), [])

  async function createPlan() {
    setCreating(true)
    try {
      const detail = await post<PlanDetail>('/plans', {
        label: `Plan ${new Date().toLocaleString()}`,
      })
      toast.success('Plan created', `${detail.matches.length} match(es) reserved`)
      setOpenPlan(detail)
      plans.reload()
      preview.reload()
    } catch (err) {
      toast.error('Could not create the plan', err instanceof Error ? err.message : '')
    } finally {
      setCreating(false)
    }
  }

  async function decide(action: 'approve' | 'discard') {
    if (!openPlan) return
    setDeciding(true)
    try {
      const result = await post<{ missionsCreated?: number; released?: number }>(
        `/plans/${openPlan.plan.id}/${action}`,
        {},
      )
      toast.success(
        action === 'approve' ? 'Plan approved' : 'Plan discarded',
        action === 'approve'
          ? `${result.missionsCreated} mission(s) created`
          : `${result.released} reservation(s) released`,
      )
      const refreshed = await get<PlanDetail>(`/plans/${openPlan.plan.id}`)
      setOpenPlan(refreshed)
      plans.reload()
      preview.reload()
    } catch (err) {
      toast.error('Could not complete that', err instanceof Error ? err.message : '')
    } finally {
      setDeciding(false)
      setConfirm(null)
    }
  }

  async function openDetail(id: string) {
    try {
      setOpenPlan(await get<PlanDetail>(`/plans/${id}`))
    } catch (err) {
      toast.error('Could not open the plan', err instanceof Error ? err.message : '')
    }
  }

  if (openPlan) {
    return (
      <PlanDetailView
        detail={openPlan}
        onBack={() => setOpenPlan(null)}
        onApprove={() => setConfirm('approve')}
        onDiscard={() => setConfirm('discard')}
        confirm={confirm}
        deciding={deciding}
        onCancelConfirm={() => setConfirm(null)}
        onConfirm={() => confirm && decide(confirm)}
      />
    )
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Response planning</h1>
          <p className="mt-1 text-sm text-ink-2">
            What the engine would do with the pool as it stands. Looking costs nothing —
            creating a plan reserves the stock.
          </p>
        </div>
        <Button onClick={createPlan} loading={creating} disabled={!preview.data?.matches.length}>
          Create plan from this proposal
        </Button>
      </div>

      {preview.loading && <SkeletonList rows={4} />}
      {preview.error && !preview.loading && (
        <ErrorState
          title="Could not build a proposal"
          message={preview.error}
          onRetry={preview.reload}
        />
      )}

      {preview.data && <ProposalView preview={preview.data} />}

      <Card>
        <CardHeader title="Plans" description="Newest first." />
        <CardBody className="p-0">
          {plans.loading && <div className="px-5 py-4"><SkeletonList rows={2} /></div>}
          {plans.data?.plans.length === 0 && (
            <p className="px-5 py-4 text-sm text-ink-2">No plans yet.</p>
          )}
          <ul className="divide-y divide-line">
            {plans.data?.plans.map((plan) => (
              <li key={plan.id}>
                <button
                  type="button"
                  onClick={() => openDetail(plan.id)}
                  className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-sunken/60"
                >
                  <PlanStatusBadge status={plan.status} />
                  <span className="text-sm text-ink">{plan.label ?? 'Untitled plan'}</span>
                  {plan.coverage != null && (
                    <span className="text-xs tabular text-ink-2">
                      {Math.round(plan.coverage * 100)}% covered
                    </span>
                  )}
                  <span className="ml-auto text-xs text-ink-3">
                    {new Date(plan.created_at).toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </section>
  )
}

function PlanStatusBadge({ status }: { status: ResponsePlan['status'] }) {
  const tone = status === 'approved' ? 'positive' : status === 'discarded' ? 'neutral' : 'warning'
  return (
    <Badge tone={tone} className="capitalize">
      {status}
    </Badge>
  )
}

function ProposalView({ preview }: { preview: PlanPreview }) {
  const excluded =
    preview.needsMissingCoordinates.length + preview.resourcesMissingCoordinates.length

  if (preview.matches.length === 0) {
    return (
      <EmptyState
        title="Nothing can be matched right now"
        description={
          preview.unmatched[0]?.reason ??
          'There are no unmet needs with coordinates, or no available resources to meet them.'
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="brand">{Math.round(preview.coverage * 100)}% of demand covered</Badge>
        <span className="text-sm text-ink-2">
          {preview.matches.length} proposed pairing{preview.matches.length === 1 ? '' : 's'}
        </span>
      </div>

      {excluded > 0 && (
        <Alert tone="warning" title="Excluded for want of coordinates">
          {preview.needsMissingCoordinates.length} need(s) and{' '}
          {preview.resourcesMissingCoordinates.length} resource(s) have no location, so
          distance cannot be scored. They are handled by hand — never guessed.
        </Alert>
      )}

      {preview.unmatched.length > 0 && (
        <Card>
          <CardHeader title="Not covered" description="What this proposal cannot solve." />
          <CardBody className="p-0">
            <ul className="divide-y divide-line">
              {preview.unmatched.map((item, i) => (
                <li key={i} className="px-5 py-2.5 text-sm text-ink-2">
                  {item.reason}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {preview.matches.map((match, i) => (
          <Card key={`${match.needId}-${match.resourceId}-${i}`}>
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium text-ink">
                  {match.quantity == null ? 'Unmetered' : match.quantity.toLocaleString()}
                </span>
                <span className="text-xs text-ink-2">
                  over {match.distanceKm.toFixed(1)} km
                </span>
                <span className="ml-auto text-xs tabular text-ink-3">
                  need priority {match.needPriority.toFixed(0)}
                </span>
              </div>
              <MatchRationale terms={match.terms} score={match.score} />
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  )
}

function PlanDetailView({
  detail,
  onBack,
  onApprove,
  onDiscard,
  confirm,
  deciding,
  onCancelConfirm,
  onConfirm,
}: {
  detail: PlanDetail
  onBack: () => void
  onApprove: () => void
  onDiscard: () => void
  confirm: 'approve' | 'discard' | null
  deciding: boolean
  onCancelConfirm: () => void
  onConfirm: () => void
}) {
  const { plan, matches } = detail
  const decidable = plan.status === 'proposed'

  return (
    <section className="space-y-5">
      <div>
        <button type="button" onClick={onBack} className="text-xs text-ink-2 hover:text-ink">
          &larr; All plans
        </button>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <PlanStatusBadge status={plan.status} />
          {plan.coverage != null && (
            <span className="text-xs tabular text-ink-2">
              {Math.round(plan.coverage * 100)}% covered
            </span>
          )}
        </div>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-ink">
          {plan.label ?? 'Untitled plan'}
        </h1>
      </div>

      {plan.status === 'proposed' && (
        <Alert tone="info" title="This plan is holding stock">
          Everything below is reserved and unavailable to other plans. Approve it to create
          missions, or discard it to give the stock back — leaving it open quietly shrinks
          the pool for everyone else.
        </Alert>
      )}

      {decidable && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={onApprove}>Approve and create missions</Button>
          <Button variant="secondary" onClick={onDiscard}>
            Discard and release
          </Button>
        </div>
      )}

      {plan.unmatched.length > 0 && (
        <Card>
          <CardHeader title="Not covered by this plan" />
          <CardBody className="p-0">
            <ul className="divide-y divide-line">
              {plan.unmatched.map((item, i) => (
                <li key={i} className="px-5 py-2.5 text-sm text-ink-2">
                  {item.reason}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {matches.map((match) => {
          const remaining = timeUntil(match.resources?.expiry_time ?? null)
          return (
            <Card key={match.id}>
              <CardBody className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-ink">
                    {match.resources?.label ?? 'Resource'}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-2">
                    {formatQuantity(match.allocated_quantity, match.resources?.unit ?? null)}
                    {match.distance_km != null && ` · ${match.distance_km.toFixed(1)} km`}
                    {remaining && ` · ${remaining}`}
                  </p>
                </div>

                <div className="rounded-control border border-line px-3 py-2">
                  <p className="text-xs uppercase tracking-wide text-ink-3">Serves</p>
                  <p className="mt-0.5 text-[13px] capitalize text-ink">
                    {match.needs?.kind} —{' '}
                    <span className="normal-case text-ink-2">
                      {match.needs?.incidents?.summary ?? 'incident'}
                    </span>
                  </p>
                </div>

                {match.rationale?.terms && (
                  <MatchRationale terms={match.rationale.terms} score={match.score} />
                )}
              </CardBody>
            </Card>
          )
        })}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'approve' ? 'Approve this plan?' : 'Discard this plan?'}
        description={
          confirm === 'approve' ? (
            <>
              This creates <strong>{matches.length} mission(s)</strong> and commits the
              reserved stock. Volunteers will be dispatched against it.
            </>
          ) : (
            <>
              This releases <strong>{matches.length} reservation(s)</strong> back to the
              pool. The plan cannot be approved afterwards.
            </>
          )
        }
        confirmLabel={confirm === 'approve' ? 'Approve' : 'Discard'}
        destructive={confirm === 'discard'}
        loading={deciding}
        onConfirm={onConfirm}
        onCancel={onCancelConfirm}
      />
    </section>
  )
}
