import { cn } from '../../lib/cn'

/**
 * Placeholder block for content that is still loading. Sized by the caller so
 * the skeleton occupies the same space the real content will, which is the
 * whole point — a skeleton that reflows on load is worse than a spinner.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-sunken', className)}
    />
  )
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full" />
      ))}
    </div>
  )
}
