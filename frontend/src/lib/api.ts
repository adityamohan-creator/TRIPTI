import { supabase } from './supabase'

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }

  /** True when signing in again is the fix, rather than retrying. */
  get isAuthError() {
    return this.status === 401 || this.status === 403
  }
}

/**
 * Calls the backend API with the caller's Supabase access token attached.
 * The backend verifies that token and derives the user's role from it, so the
 * client never asserts its own role.
 *
 * Failures always surface as an ApiError with a message worth showing a user —
 * including the cases where the server returned no body at all, or the network
 * never reached it.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  const headers = new Headers(init.headers)
  if (init.body !== undefined) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection.')
  }

  const text = await res.text()
  let parsed: unknown = null
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      // A proxy error page or a gateway timeout — HTML, not JSON. Falling through
      // with parsed = null gives the status-based message below.
    }
  }

  if (!res.ok) {
    const message =
      (parsed as { error?: string } | null)?.error ??
      (res.status >= 500
        ? 'The server ran into a problem. Try again in a moment.'
        : res.statusText || 'Request failed')
    throw new ApiError(res.status, message)
  }

  return parsed as T
}

export const get = <T>(path: string) => api<T>(path)

export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const patch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
