import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/**
 * Values that are present but meaningless — the placeholders shipped in
 * `.env.example`. Copying the template and forgetting to edit it is the single
 * most common setup mistake, and a presence-only check waves it straight
 * through: the app boots, looks configured, and then every request dies with an
 * opaque `Failed to fetch` from a hostname that does not resolve.
 */
const PLACEHOLDERS = [
  'your-project',
  'your-anon-key',
  'unconfigured',
  'placeholder',
  'paste_',
]

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true
  const lowered = value.toLowerCase()
  return PLACEHOLDERS.some((marker) => lowered.includes(marker))
}

/**
 * Whether the browser has what it needs to reach Supabase at all.
 *
 * This module used to throw at import scope when the env was missing, which took
 * down the entire bundle and rendered a blank white page — the least useful
 * possible response to a missing config value. The app checks this flag at the
 * root and renders a setup screen instead, so a fresh clone tells you what to do
 * rather than looking broken.
 */
export const isSupabaseConfigured =
  !isPlaceholder(url) && !isPlaceholder(anonKey)

/**
 * Browser Supabase client. Only ever holds the anon key — every table it can
 * reach must be protected by row level security. Privileged reads and writes go
 * through the backend, which holds the service role key.
 *
 * The fallbacks below only exist so `createClient` can be constructed when the
 * app is unconfigured; nothing calls it in that state.
 */
export const supabase = createClient(
  url || 'https://unconfigured.supabase.co',
  anonKey || 'unconfigured',
  { auth: { persistSession: true, autoRefreshToken: true } },
)
