import { Suspense, lazy, useState } from 'react'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Skeleton } from '../../components/ui/Skeleton'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { useAsync } from '../../hooks/useAsync'
import { cn } from '../../lib/cn'
import { get } from '../../lib/api'
import type { ImpactReport } from '../../types/api'
import { count, duration, percent } from './format'

/*
 * Recharts is around 350 kB, and loading it eagerly put it in the main chunk —
 * downloaded by everyone on every route, including the sign-in page, to draw
 * two charts on one screen. Split out, it is fetched when a dashboard actually
 * has figures to plot. The numbers above the charts render without it.
 */
const DeliveriesChart = lazy(() =>
  import('./ImpactCharts').then((m) => ({ default: m.DeliveriesChart })),
)
const KindChart = lazy(() =>
  import('./ImpactCharts').then((m) => ({ default: m.KindChart })),
)

const WINDOWS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const

function Figure({
  label,
  value,
  hint,
  loading,
}: {
  label: string
  value: string
  hint?: string
  loading: boolean
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">{label}</p>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-20" />
      ) : (
        <p className="mt-1 truncate text-2xl font-semibold tracking-tight text-ink tabular-nums">
          {value}
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </div>
  )
}

function WindowPicker({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (days: number) => void
  disabled: boolean
}) {
  return (
    <div
      role="group"
      aria-label="Reporting period"
      className="inline-flex rounded-control border border-line bg-sunken p-0.5"
    >
      {WINDOWS.map((w) => (
        <button
          key={w.days}
          type="button"
          disabled={disabled}
          aria-pressed={value === w.days}
          onClick={() => onChange(w.days)}
          className={cn(
            'rounded-[0.3rem] px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
            value === w.days
              ? 'bg-raised text-ink shadow-solid'
              : 'text-ink-2 hover:text-ink',
          )}
        >
          {w.label}
        </button>
      ))}
    </div>
  )
}

function UtilisationCard({ report }: { report: ImpactReport }) {
  const u = report.utilisation
  if (!u) return null

  const rows: [string, string][] = [
    ['Stock committed', percent(u.stockCommitted)],
    ['Volunteers available', `${count(u.volunteersAvailable)} of ${count(u.volunteersTotal)}`],
    ['Vehicles available', `${count(u.vehiclesAvailable)} of ${count(u.vehiclesTotal)}`],
  ]

  return (
    <Card>
      <CardHeader
        title="Pool right now"
        description="Live, not part of the reporting period."
      />
      <CardBody>
        <dl className="space-y-3">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline gap-3">
              <dt className="text-sm text-ink-2">{label}</dt>
              <dd className="ml-auto text-sm font-medium tabular-nums text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        {u.stockCommitted == null && (
          <p className="mt-3 text-xs text-ink-3">
            No measurable stock in the pool — a rescue team has no quantity to take a
            share of, so no percentage is shown.
          </p>
        )}
      </CardBody>
    </Card>
  )
}

/**
 * What the response achieved, counted from confirmed deliveries only.
 *
 * The distinction is the point of the whole screen. A mission a volunteer
 * marked delivered but nobody confirmed is not evidence that anything reached
 * anyone, and every figure here is one a coordinator may be asked to stand
 * behind in a review.
 */
export function ImpactSection() {
  const [days, setDays] = useState<number>(30)
  const { data, loading, error, reload } = useAsync(
    () => get<ImpactReport>(`/impact?days=${days}`),
    [days],
  )

  if (error) {
    return <ErrorState title="Could not load impact figures" message={error} onRetry={reload} />
  }

  const totals = data?.totals
  const nothingYet = data != null && totals!.missionsCompleted === 0

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-ink">Impact</h2>
          <p className="mt-0.5 text-sm text-ink-2">
            Confirmed deliveries only. A delivery nobody verified is not counted.
          </p>
        </div>
        <WindowPicker value={days} onChange={setDays} disabled={loading} />
      </div>

      {nothingYet ? (
        <EmptyState
          title="Nothing has been verified in this period"
          description={
            data.allTime.missionsCompleted > 0
              ? `${count(data.allTime.missionsCompleted)} deliveries were confirmed before this window. Try a longer period.`
              : 'Figures appear once a coordinator confirms a delivery on the missions board. Marking a mission delivered is not enough on its own.'
          }
        />
      ) : (
        <>
          <Card>
            <CardBody className="grid grid-cols-2 gap-x-6 gap-y-6 md:grid-cols-3 lg:grid-cols-6">
              <Figure
                label="People reached"
                value={count(totals?.peopleHelped ?? 0)}
                hint={
                  totals && totals.incidentsWithoutHeadcount > 0
                    ? `${totals.incidentsWithoutHeadcount} incident${totals.incidentsWithoutHeadcount === 1 ? '' : 's'} gave no headcount`
                    : 'Counted once per incident'
                }
                loading={loading}
              />
              <Figure
                label="Deliveries"
                value={count(totals?.missionsCompleted ?? 0)}
                hint={`Across ${count(totals?.incidentsServed ?? 0)} incidents`}
                loading={loading}
              />
              <Figure
                label="Meals"
                value={count(totals?.mealsDelivered ?? 0)}
                loading={loading}
              />
              <Figure
                label="Water"
                value={`${count(totals?.waterLitres ?? 0)} L`}
                loading={loading}
              />
              <Figure
                label="Food rescued"
                value={`${count(totals?.foodKgRescued ?? 0)} kg`}
                hint="Perishable only"
                loading={loading}
              />
              <Figure
                label="Median response"
                value={duration(totals?.medianResponseMinutes ?? null)}
                hint={
                  totals?.fastestResponseMinutes != null
                    ? `Fastest ${duration(totals.fastestResponseMinutes)}`
                    : 'Report to first delivery'
                }
                loading={loading}
              />
            </CardBody>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader
                title="Deliveries confirmed"
                description={`Per day over the last ${days} days.`}
              />
              <CardBody>
                {loading || !data ? (
                  <Skeleton className="h-56 w-full" />
                ) : (
                  <Suspense fallback={<Skeleton className="h-56 w-full" />}>
                    <DeliveriesChart days={data.timeline} />
                  </Suspense>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="By kind" description="Deliveries, not quantities." />
              <CardBody>
                {loading || !data ? (
                  <Skeleton className="h-56 w-full" />
                ) : (
                  <Suspense fallback={<Skeleton className="h-56 w-full" />}>
                    <KindChart kinds={data.byKind} />
                  </Suspense>
                )}
              </CardBody>
            </Card>
          </div>

          {data && (
            <div className="grid gap-4 lg:grid-cols-3">
              <UtilisationCard report={data} />
              <Card className={data.utilisation ? 'lg:col-span-2' : 'lg:col-span-3'}>
                <CardHeader title="Since the beginning" description="Every confirmed delivery on record." />
                <CardBody className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                  <Figure
                    label="People reached"
                    value={count(data.allTime.peopleHelped)}
                    loading={false}
                  />
                  <Figure
                    label="Deliveries"
                    value={count(data.allTime.missionsCompleted)}
                    loading={false}
                  />
                  <Figure
                    label="Food rescued"
                    value={`${count(data.allTime.foodKgRescued)} kg`}
                    loading={false}
                  />
                  <Figure
                    label="Median response"
                    value={duration(data.allTime.medianResponseMinutes)}
                    loading={false}
                  />
                </CardBody>
              </Card>
            </div>
          )}
        </>
      )}
    </section>
  )
}
