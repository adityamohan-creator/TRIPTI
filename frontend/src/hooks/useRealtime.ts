import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Refetches when a table changes.
 *
 * Deliberately does not use the payload. A realtime event carries the row as
 * the database saw it, not as this user is allowed to see it — rendering it
 * directly would show a volunteer missions that are not theirs and a citizen
 * incidents they never reported. Treating the event as "something changed, ask
 * again" keeps every authorization check in the path it was written for.
 *
 * The callback is held in a ref so a caller can pass an inline function without
 * tearing down and rebuilding the subscription on every render.
 */
export function useRealtime(tables: string[], onChange: () => void) {
  const callback = useRef(onChange)

  // Updated in an effect rather than during render. Writing a ref while
  // rendering is a side effect in a place React reserves the right to run
  // twice or abandon, and the subscription only ever reads it much later.
  useEffect(() => {
    callback.current = onChange
  }, [onChange])

  // Joined so a caller can pass an inline array without resubscribing forever.
  const key = tables.join(',')

  useEffect(() => {
    const names = key.split(',').filter(Boolean)
    if (names.length === 0) return

    let timer: number | undefined

    /*
     * One refetch per burst. Approving a plan writes a row per mission, and
     * without this the board would fire a request for each of them — the exact
     * moment a coordinator least wants the page busy.
     */
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => callback.current(), 250)
    }

    const channel = supabase.channel(`tripti:${names.join('-')}`)

    for (const table of names) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, schedule)
    }

    channel.subscribe()

    return () => {
      window.clearTimeout(timer)
      void supabase.removeChannel(channel)
    }
  }, [key])
}
