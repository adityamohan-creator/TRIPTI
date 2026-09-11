import type { RealtimeStatus } from '../../hooks/useRealtime'
import { cn } from '../../lib/cn'

/**
 * Says whether the screen is actually being kept current.
 *
 * Not decoration. During an incident a coordinator acts on what this board
 * shows, and a dropped connection is otherwise invisible — the page looks
 * exactly as alive as it did a minute ago. Three honest states, no green dot
 * that means "probably".
 */

const LABEL: Record<RealtimeStatus, string> = {
  connecting: 'Connecting',
  live: 'Live',
  polling: 'Refreshing every 15s',
}

const TITLE: Record<RealtimeStatus, string> = {
  connecting: 'Opening the live connection.',
  live: 'Changes appear as they happen.',
  polling:
    'The live connection dropped, so this screen is asking for changes every 15 seconds instead. Still current, just slower.',
}

const DOT: Record<RealtimeStatus, string> = {
  connecting: 'bg-ink-3',
  live: 'bg-positive',
  polling: 'bg-warning',
}

export function LiveIndicator({
  status,
  className,
}: {
  status: RealtimeStatus
  className?: string
}) {
  return (
    <span
      title={TITLE[status]}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs text-ink-2 whitespace-nowrap',
        className,
      )}
    >
      <span className="relative flex size-1.5 shrink-0">
        {status === 'live' && (
          // Purely decorative pulse; the dot underneath carries the meaning.
          <span
            aria-hidden
            className="absolute inline-flex size-full animate-ping rounded-full bg-positive opacity-60"
          />
        )}
        <span className={cn('relative inline-flex size-1.5 rounded-full', DOT[status])} />
      </span>
      {LABEL[status]}
    </span>
  )
}
