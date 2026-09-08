import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

type Tone = 'info' | 'success' | 'warning' | 'danger'

const TONES: Record<Tone, string> = {
  info: 'border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-100',
  success: 'border-positive/30 bg-positive/10 text-positive',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-danger/30 bg-danger/10 text-danger',
}

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: Tone
  title?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <div
      // Failures need to interrupt a screen reader; the rest can wait its turn.
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-control border px-4 py-3 text-sm', TONES[tone], className)}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title ? 'mt-1' : undefined, 'opacity-90')}>{children}</div>}
    </div>
  )
}
