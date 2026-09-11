import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ImpactDay, ImpactKind } from '../../types/api'
import { count, quantity, shortDate } from './format'

/*
 * Charts read their colours from the theme tokens rather than hex literals, so
 * the severity ramp and the brand green stay in one place — SVG resolves
 * var() the same as any other property.
 */
const AXIS = 'var(--color-ink-3)'
const GRID = 'var(--color-line)'
const BRAND = 'var(--color-brand-600)'

const axisProps = {
  stroke: AXIS,
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const

/**
 * A whole-number axis that stops at the data.
 *
 * Left to itself the library picks five "nice" ticks, so a day with one
 * delivery is drawn against a 0-4 axis and a real result reads as a rounding
 * error. Early in a response the numbers are small, and they should still look
 * like numbers.
 */
function countAxis(values: number[]) {
  const max = Math.max(1, ...values)
  return {
    domain: [0, max] as [number, number],
    // One tick per unit while that stays legible, then let it thin out.
    tickCount: max <= 5 ? max + 1 : 6,
    allowDecimals: false,
  }
}

function TooltipCard({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-control border border-line bg-raised px-3 py-2 shadow-overlay">
      <p className="text-xs font-semibold text-ink">{title}</p>
      <dl className="mt-1 space-y-0.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-3 text-xs">
            <dt className="text-ink-2">{label}</dt>
            <dd className="ml-auto tabular-nums text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * Confirmed deliveries per day.
 *
 * Every day in the window is plotted, including the empty ones. A line drawn
 * only through the days that have data slopes gently across a week where
 * nothing moved, which is the opposite of what happened.
 */
export function DeliveriesChart({ days }: { days: ImpactDay[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={days} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="deliveries-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={BRAND} stopOpacity={0.22} />
              <stop offset="100%" stopColor={BRAND} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            minTickGap={24}
            {...axisProps}
          />
          <YAxis width={40} {...axisProps} {...countAxis(days.map((d) => d.deliveries))} />
          <Tooltip
            cursor={{ stroke: GRID }}
            content={({ active, payload }) => {
              const day = active ? (payload?.[0]?.payload as ImpactDay | undefined) : undefined
              if (!day) return null
              return (
                <TooltipCard
                  title={shortDate(day.date)}
                  rows={[
                    ['Deliveries confirmed', count(day.deliveries)],
                    ['Incidents first reached', count(day.incidentsFirstServed)],
                  ]}
                />
              )
            }}
          />
          <Area
            /*
             * Linear, not a spline. A day's deliveries are a count of discrete
             * events, and a smoothed curve through them bulges above and dips
             * below the real values — drawing half a delivery on a day nothing
             * was confirmed. Straight segments between known points claim only
             * what was measured.
             */
            type="linear"
            dataKey="deliveries"
            stroke={BRAND}
            strokeWidth={2}
            fill="url(#deliveries-fill)"
            // No dots on a 30-day series: they crowd into a solid band and hide
            // the shape they are meant to mark.
            dot={days.length <= 14 ? { r: 2.5, fill: BRAND, strokeWidth: 0 } : false}
            activeDot={{ r: 4, fill: BRAND, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/*
 * A fixed palette rather than a generated one. Kinds are a handful of stable
 * categories, and a colour that shifts when a new kind appears makes two
 * screenshots of the same week disagree.
 */
const KIND_FILL: Record<string, string> = {
  food: 'var(--color-brand-600)',
  water: 'var(--color-sev-low)',
  medicine: 'var(--color-sev-high)',
  shelter: 'var(--color-sev-medium)',
  rescue: 'var(--color-sev-critical)',
}
const KIND_FALLBACK = 'var(--color-brand-300)'

/** What was delivered, by kind. Counts, because units do not always add up. */
export function KindChart({ kinds }: { kinds: ImpactKind[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={kinds}
          layout="vertical"
          margin={{ top: 4, right: 12, bottom: 0, left: 8 }}
        >
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            {...axisProps}
            {...countAxis(kinds.map((k) => k.deliveries))}
          />
          <YAxis
            type="category"
            dataKey="kind"
            width={78}
            className="capitalize"
            {...axisProps}
          />
          <Tooltip
            cursor={{ fill: 'var(--color-sunken)' }}
            content={({ active, payload }) => {
              const kind = active ? (payload?.[0]?.payload as ImpactKind | undefined) : undefined
              if (!kind) return null
              return (
                <TooltipCard
                  title={kind.kind}
                  rows={[
                    ['Deliveries', count(kind.deliveries)],
                    [
                      'Total',
                      kind.quantity == null
                        ? 'mixed units'
                        : quantity(kind.quantity, kind.unit),
                    ],
                  ]}
                />
              )
            }}
          />
          <Bar dataKey="deliveries" radius={[0, 3, 3, 0]} isAnimationActive={false}>
            {kinds.map((kind) => (
              <Cell key={kind.kind} fill={KIND_FILL[kind.kind] ?? KIND_FALLBACK} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
