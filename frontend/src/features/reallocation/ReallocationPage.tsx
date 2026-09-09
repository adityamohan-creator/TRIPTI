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
import { useRealtime } from '../../hooks/useRealtime'
import { get, post } from '../../lib/api'
import type { Reallocation, ReallocationPreview } from '../../types/api'

/**
 * The screen where a coordinator takes a delivery away from one group of people
 * and gives it to another.
 *
 * Built around what is *not* moving as much as what is. The protected list is
 * given equal weight to the moves, because the judgement a coordinator most
 * needs to check is the one the system made on its own — and the only way to
 * disagree with it is to see it.
 */
export function ReallocationPage() {
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)

  const preview = useAsync(() => get<ReallocationPreview>('/reallocation/preview'), [])
  const history = useAsync(() => get<{ reallocations: Reallocation[] }>('/reallocation'), [])

  // A new incident changes what is worth moving, so the proposal should not go
  // stale while a coordinator is looking at it.
  useRealtime(['incidents', 'needs', 'missions', 'matches'], preview.reload)

  async function apply() {
    setWorking(true)
    try {
      const created = await post<{ reallocation: Reallocation }>('/reallocation', {})
      const result = await post<{ applied: number; total: number; skipped: { reason: string }[] }>(
        `/reallocation/${created.reallocation.id}/approve`,
        {},
      )

      toast.success(
        `${result.applied} of ${result.total} move(s) applied`,
        result.skipped.length > 0
          ? `${result.skipped.length} left alone — a volunteer had taken the run on.`
          : undefined,
      )
      preview.reload()
      history.reload()
    } catch (err) {
      toast.error('Could not reallocate', err instanceof Error ? err.message : '')
    } finally {
      setWorking(false)
      setConfirming(false)
    }
  }

  const data = preview.data

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Reallocation</h1>
          <p className="mt-1 text-sm text-ink-2">
            Stock that could be moved to a need that is materially worse off. Nothing is
            moved until you say so, and nothing already in motion is touched.
          </p>
        </div>
        {data && data.moves.length > 0 && (
          <Button onClick={() => setConfirming(true)} loading={working}>
            Apply {data.moves.length} move{data.moves.length === 1 ? '' : 's'}
          </Button>
        )}
      </div>

      {preview.loading && <SkeletonList rows={4} />}
      {preview.error && !preview.loading && (
        <ErrorState
          title="Could not build a proposal"
          message={preview.error}
          onRetry={preview.reload}
        />
      )}

      {data && data.moves.length === 0 && (
        <EmptyState
          title="Nothing worth moving"
          description={`Every commitment is either already in motion or serving a need at least as urgent. A move is only proposed when the receiving need scores ${data.minPriorityGain} or more points higher.`}
        />
      )}

      {data && data.moves.length > 0 && (
        <div className="space-y-3">
          {data.moves.map((move, i) => (
            <Card key={`${move.matchId}-${i}`}>
              <CardBody>
                <div className="flex flex-wrap items-center gap-3">
                  {/* The before and after, stated as plainly as possible. */}
                  <span className="text-sm text-ink-2 line-through">
                    priority {move.fromPriority.toFixed(0)}
                  </span>
                  <span aria-hidden="true" className="text-ink-3">
                    &rarr;
                  </span>
                  <span className="text-sm font-medium text-ink">
                    priority {move.toPriority.toFixed(0)}
                  </span>
                  <Badge tone="positive">+{move.priorityGain.toFixed(0)}</Badge>
                  <span className="ml-auto text-xs text-ink-3 tabular">
                    {move.distanceKm.toFixed(1)} km · match scores {move.score.toFixed(0)}
                  </span>
                </div>

                <p className="mt-2 text-sm text-ink-2">{move.rationale}</p>

                <p className="mt-1.5 text-xs text-ink-3">
                  {move.quantity == null
                    ? 'Unmetered allocation'
                    : `${move.quantity.toLocaleString()} units`}{' '}
                  moved from need {move.fromNeedId.slice(0, 8)} to {move.toNeedId.slice(0, 8)}
                </p>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {data && data.protectedCommitments.length > 0 && (
        <Card>
          <CardHeader
            title="Left alone"
            description="What the system refused to move, and why. Disagree with any of it by reassigning by hand."
          />
          <CardBody className="p-0">
            <ul className="divide-y divide-line">
              {data.protectedCommitments.map((item, i) => (
                <li key={i} className="px-5 py-2.5 text-sm text-ink-2">
                  {item.reason}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {data && data.stillUnserved.length > 0 && (
        <Alert tone="warning" title="Still unserved after everything movable was considered">
          {data.stillUnserved[0]!.reason}
        </Alert>
      )}

      {history.data && history.data.reallocations.length > 0 && (
        <Card>
          <CardHeader title="Past reallocations" />
          <CardBody className="p-0">
            <ul className="divide-y divide-line">
              {history.data.reallocations.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <Badge tone={item.status === 'approved' ? 'positive' : 'neutral'} className="capitalize">
                    {item.status}
                  </Badge>
                  <span className="text-sm text-ink">{item.label ?? 'Reallocation'}</span>
                  <span className="text-xs text-ink-2">
                    {(item.moves ?? []).length} move(s)
                  </span>
                  <span className="ml-auto text-xs text-ink-3">
                    {new Date(item.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <ConfirmDialog
        open={confirming}
        title="Move this stock?"
        description={
          <>
            This takes <strong>{data?.moves.length ?? 0} allocation(s)</strong> away from
            the needs currently holding them. Each move is re-checked as it is applied — if
            a volunteer has taken a run on since this was calculated, that one is left
            alone rather than pulled out from under them.
          </>
        }
        confirmLabel="Move it"
        loading={working}
        onConfirm={apply}
        onCancel={() => setConfirming(false)}
      />
    </section>
  )
}
