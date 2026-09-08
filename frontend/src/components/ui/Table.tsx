import type { ReactNode } from 'react'
import { cn } from '../../lib/cn'

/**
 * A plain, dense table. No zebra striping, no inner vertical rules — hairline
 * row dividers and alignment carry the structure, which is what makes a long
 * list scannable instead of busy.
 *
 * Always wrapped in its own horizontal scroller: the page body must never
 * scroll sideways because one column was wide.
 */
export function Table({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('overflow-x-auto rounded-card border border-line bg-raised', className)}>
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  )
}

export function Th({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode
  align?: 'left' | 'right'
  className?: string
}) {
  return (
    <th
      scope="col"
      className={cn(
        'border-b border-line px-3 py-2.5 text-xs font-medium uppercase tracking-wide text-ink-3 sm:px-4',
        align === 'right' && 'text-right',
        className,
      )}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode
  align?: 'left' | 'right'
  className?: string
}) {
  return (
    <td
      className={cn(
        'border-b border-line px-3 py-3 align-middle text-sm text-ink sm:px-4',
        align === 'right' && 'text-right',
        className,
      )}
    >
      {children}
    </td>
  )
}

export function Tr({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <tr className={cn('transition-colors last:[&>td]:border-b-0 hover:bg-sunken/60', className)}>
      {children}
    </tr>
  )
}
