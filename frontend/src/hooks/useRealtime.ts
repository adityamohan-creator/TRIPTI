import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Connection state, as the screen needs to describe it.
 *
 * `polling` is not a failure mode the user has to act on, but it is not "live"
 * either, and the difference matters: a coordinator watching a board during an
 * incident is entitled to know whether it is being pushed changes or asked for
 * them every fifteen seconds.
 */
export type RealtimeStatus = 'connecting' | 'live' | 'polling'

/** How often to ask when the socket is not telling us. */
const POLL_MS = 15_000

/** One refetch per burst of events. */
const BURST_MS = 250

export interface UseRealtimeOptions {
  /** Set false to tear the subscription down — e.g. while signed out. */
  enabled?: boolean
}

/**
 * Refetches when a table changes, and says whether it is actually connected.
 *
 * Deliberately does not use the event payload. A realtime event carries the row
 * as the database saw it, not as this user is allowed to see it — rendering it
 * directly would show a volunteer missions that are not theirs and a citizen
 * incidents they never reported. Treating the event as "something changed, ask
 * again" keeps every authorization check in the path it was written for.
 *
 * When the channel cannot connect, it falls back to polling rather than going
 * quiet. A stale board that looks live is worse than a slow one: the whole
 * point of this screen during an incident is that what it shows is current, and
 * a dropped websocket is invisible unless something says so. The returned
 * status is what the UI uses to say it out loud.
 */
export function useRealtime(
  tables: string[],
  onChange: () => void,
  options: UseRealtimeOptions = {},
): RealtimeStatus {
  const enabled = options.enabled ?? true
  const callback = useRef(onChange)

  /*
   * Only ever written from the channel's own status callback — an external
   * system telling us something changed, which is what an effect is for.
   * The disabled case is derived at the return instead of stored, so nothing
   * here sets state synchronously during an effect and starts a second render.
   */
  const [channelStatus, setChannelStatus] = useState<RealtimeStatus>('connecting')

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
    if (names.length === 0 || !enabled) return

    let burst: number | undefined
    let poll: number | undefined
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | undefined

    /*
     * One refetch per burst. Approving a plan writes a row per mission, and
     * without this the board would fire a request for each of them — the exact
     * moment a coordinator least wants the page busy.
     */
    const schedule = () => {
      window.clearTimeout(burst)
      burst = window.setTimeout(() => {
        if (!cancelled) callback.current()
      }, BURST_MS)
    }

    const startPolling = () => {
      if (poll !== undefined) return
      poll = window.setInterval(() => {
        if (!cancelled) callback.current()
      }, POLL_MS)
    }

    const stopPolling = () => {
      window.clearInterval(poll)
      poll = undefined
    }

    /*
     * Hand the socket the user's token before subscribing.
     *
     * This is the whole reason realtime appeared to work and delivered nothing.
     * The websocket authenticates with the anon key unless told otherwise, and
     * `postgres_changes` is filtered by row level security per subscriber — so
     * every policy of the form `auth.uid() is not null` matched no rows and the
     * server correctly sent us nothing. The channel still reports SUBSCRIBED,
     * because subscribing *did* succeed. The board just sat there looking live.
     *
     * Awaiting the session also removes the race on first paint: these screens
     * mount inside a protected route, but the client restores its session
     * asynchronously and a channel opened in the same tick would connect
     * unauthenticated.
     */
    const connect = async () => {
      const { data } = await supabase.auth.getSession()
      if (cancelled) return

      const token = data.session?.access_token
      if (!token) {
        // Nothing to subscribe as. Every screen using this sits behind auth, so
        // this is a transient state during sign-out rather than a mode to
        // support — poll rather than claim to be live.
        setChannelStatus('polling')
        startPolling()
        return
      }

      supabase.realtime.setAuth(token)

      channel = supabase.channel(`tripti:${names.join('-')}`)

      for (const table of names) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, schedule)
      }

      channel.subscribe((state) => {
        if (cancelled) return

        if (state === 'SUBSCRIBED') {
          stopPolling()
          setChannelStatus('live')
          /*
           * Refetch on connect, not only on the next event. Anything that
           * changed while the socket was down produced no event for this
           * client, so without this the board silently keeps whatever it had
           * from before the drop — the exact staleness this hook exists to
           * prevent.
           */
          callback.current()
          return
        }

        // CHANNEL_ERROR, TIMED_OUT, CLOSED. The client retries on its own;
        // until it succeeds, keep the data moving by asking.
        setChannelStatus('polling')
        startPolling()
      })
    }

    void connect()

    /*
     * A refreshed token has to reach the socket too, or the subscription keeps
     * running against credentials the server has stopped honouring and goes
     * quiet an hour into a shift.
     */
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (cancelled) return
      if (session?.access_token) supabase.realtime.setAuth(session.access_token)
    })

    return () => {
      cancelled = true
      window.clearTimeout(burst)
      stopPolling()
      sub.subscription.unsubscribe()
      if (channel) void supabase.removeChannel(channel)
    }
  }, [key, enabled])

  // Derived, not stored: with no tables or while disabled there is no channel,
  // and reporting a remembered 'live' from a previous subscription would be a
  // lie of exactly the kind this hook exists to prevent.
  return enabled && key.length > 0 ? channelStatus : 'connecting'
}
