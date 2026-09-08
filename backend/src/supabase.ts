import { createClient } from '@supabase/supabase-js'
import { config } from './config.js'

/**
 * Service-role client. Bypasses row level security entirely, so every route that
 * touches it must do its own authorization check first (see requireAuth /
 * requireRole). Never expose the results of an unchecked query to a caller.
 */
export const admin = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

/**
 * Anon client, used only to verify a caller's access token.
 */
const verifier = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

export async function verifyAccessToken(token: string) {
  const { data, error } = await verifier.auth.getUser(token)
  if (error || !data.user) return null
  return data.user
}
