import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'
import type { IncidentStatus, MissionStatus, Severity } from '../../types/api'

type Tone = 'neutral' | 'brand' | 'positive' | 'warning' | 'danger'

const TONES: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-2 border-line',
  brand: 'bg-brand-50 text-brand-700 border-brand-200 dark:bg-brand-900/40 dark:text-brand-200 dark:border-brand-800',
  positive: 'bg-positive/10 text-positive border-positive/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
  danger: 'bg-danger/10 text-danger border-danger/30',
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: Tone
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

const SEVERITY_CLASS: Record<Severity, string> = {
  low: 'bg-sev-low-soft text-sev-low border-sev-low/40',
  medium: 'bg-sev-medium-soft text-sev-medium border-sev-medium/40',
  high: 'bg-sev-high-soft text-sev-high border-sev-high/40',
  critical: 'bg-sev-critical-soft text-sev-critical border-sev-critical/50',
}

/**
 * Severity always reads the same way — here, on a map marker, in a chart —
 * because all three pull the same --color-sev-* tokens.
 */
export function SeverityBadge({ severity }: { severity: Severity }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold capitalize',
        SEVERITY_CLASS[severity],
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
      {severity}
    </span>
  )
}

const INCIDENT_TONE: Record<IncidentStatus, Tone> = {
  open: 'warning',
  triaged: 'brand',
  assigned: 'brand',
  resolved: 'positive',
}

const MISSION_TONE: Record<MissionStatus, Tone> = {
  proposed: 'neutral',
  accepted: 'brand',
  en_route: 'brand',
  // Delivered is reported by the volunteer; verified is confirmed by a
  // coordinator. Only the second one is a settled outcome, so only the second
  // one reads as success.
  delivered: 'warning',
  verified: 'positive',
  failed: 'danger',
  cancelled: 'neutral',
}

export function StatusBadge({
  status,
  kind = 'incident',
}: {
  status: IncidentStatus | MissionStatus
  kind?: 'incident' | 'mission'
}) {
  const tone =
    kind === 'incident'
      ? (INCIDENT_TONE[status as IncidentStatus] ?? 'neutral')
      : (MISSION_TONE[status as MissionStatus] ?? 'neutral')

  return (
    <Badge tone={tone} className="capitalize">
      {status.replace('_', ' ')}
    </Badge>
  )
}
