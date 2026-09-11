import {
  type DisasterAlert,
  type DisasterFeedProvider,
  gdacsProvider,
} from '../integrations/disasterFeed.js'
import { admin } from '../supabase.js'

/**
 * The external alert feed, and how it relates to what we are already doing.
 *
 * Two things kept deliberately separate: what the world is reporting, and what
 * this deployment has taken on. An alert is never turned into an incident by
 * software — a coordinator reads it and decides. Everything here is read-only.
 */

/*
 * Cached because GDACS is a public good and this is polled by every open map.
 * Five minutes is well inside the rate a global alert feed changes, and it
 * means fifty coordinators watching one board cost one request.
 */
const TTL_MS = 5 * 60 * 1000

interface Cached {
  at: number
  alerts: DisasterAlert[]
}

let cache: Cached | null = null
let inFlight: Promise<DisasterAlert[]> | null = null

export interface FeedResult {
  alerts: DisasterAlert[]
  source: string
  fetchedAt: string
  /** True when the upstream call failed and this is the last good copy. */
  stale: boolean
  /** Only set when serving stale data, so the UI can say why. */
  error?: string
}

export async function getFeed(
  provider: DisasterFeedProvider = gdacsProvider,
): Promise<FeedResult> {
  const now = Date.now()

  if (cache && now - cache.at < TTL_MS) {
    return {
      alerts: cache.alerts,
      source: provider.name,
      fetchedAt: new Date(cache.at).toISOString(),
      stale: false,
    }
  }

  /*
   * One upstream request at a time. Without this, a coordinator opening the map
   * as the cache expires fires a request per open tab at the same instant —
   * which is how a free public feed starts refusing us.
   */
  if (!inFlight) {
    inFlight = provider
      .fetchAlerts()
      .then((alerts) => {
        cache = { at: Date.now(), alerts }
        return alerts
      })
      .finally(() => {
        inFlight = null
      })
  }

  try {
    const alerts = await inFlight
    return {
      alerts,
      source: provider.name,
      fetchedAt: new Date(cache?.at ?? now).toISOString(),
      stale: false,
    }
  } catch (err) {
    /*
     * An unreachable feed must not take the map down with it. Alerts are
     * context around the operation, not part of it — so serve the last good
     * copy and say plainly that it is old, rather than failing the request or,
     * worse, showing yesterday's alerts as though they were current.
     */
    const message = err instanceof Error ? err.message : 'The alert feed is unreachable.'
    if (cache) {
      return {
        alerts: cache.alerts,
        source: provider.name,
        fetchedAt: new Date(cache.at).toISOString(),
        stale: true,
        error: message,
      }
    }
    return {
      alerts: [],
      source: provider.name,
      fetchedAt: new Date(now).toISOString(),
      stale: true,
      error: message,
    }
  }
}

/** Rough kilometres between two points. Good enough to say "near". */
function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLon = ((bLon - aLon) * Math.PI) / 180
  const lat1 = (aLat * Math.PI) / 180
  const lat2 = (bLat * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Anything this close to an open incident is probably the same event. */
const NEAR_KM = 250

export interface FeedWithContext extends FeedResult {
  /**
   * Alert ids that sit near an incident already on our board.
   *
   * Flagged rather than merged. Proximity is a hint, not an identity: a cyclone
   * alert 200km from an open flood may be its cause, a coincidence, or the same
   * event under another name. A coordinator can tell; a distance check cannot.
   */
  nearActive: string[]
}

export async function getFeedWithContext(): Promise<FeedWithContext> {
  const feed = await getFeed()

  const { data: incidents, error } = await admin
    .from('incidents')
    .select('lat, lon')
    .not('lat', 'is', null)
    .neq('status', 'resolved')

  if (error) throw error

  const located = (incidents ?? []) as { lat: number; lon: number }[]

  const nearActive = feed.alerts
    .filter(
      (alert) =>
        alert.lat !== null &&
        alert.lon !== null &&
        located.some(
          (i) => distanceKm(alert.lat!, alert.lon!, i.lat, i.lon) <= NEAR_KM,
        ),
    )
    .map((a) => a.id)

  return { ...feed, nearActive }
}
