import { supabase } from './supabase'

const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Calls the backend API with the caller's Supabase access token attached.
 * The backend verifies that token and derives the user's role from it, so the
 * client never asserts its own role.
 */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token

  const headers = new Headers(init.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${BASE}${path}`, { ...init, headers })
  const body = await res.text()
  const parsed = body ? JSON.parse(body) : null

  if (!res.ok) {
    throw new ApiError(res.status, parsed?.error ?? res.statusText)
  }
  return parsed as T
}
