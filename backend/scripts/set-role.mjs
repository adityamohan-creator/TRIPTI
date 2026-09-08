#!/usr/bin/env node
/**
 * Grants a role to an existing account.
 *
 *   npm run set-role -- you@example.com coordinator
 *
 * `coordinator` and `admin` cannot be chosen at signup — three separate
 * mechanisms stop that (the registration form, the handle_new_user() trigger,
 * and the profiles_pin_role trigger). This script is the deliberate way in: it
 * uses the service role key, which bypasses row level security, and the
 * role-pinning trigger allows it because auth.uid() is null for a service-role
 * connection.
 *
 * Same effect as running the UPDATE in the SQL Editor, without leaving the
 * terminal or hand-writing a subquery against auth.users.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const ROLES = ['citizen', 'volunteer', 'donor', 'ngo', 'coordinator', 'admin']

const [email, role] = process.argv.slice(2)

if (!email || !role) {
  console.error('Usage: npm run set-role -- <email> <role>')
  console.error(`Roles: ${ROLES.join(', ')}`)
  process.exit(1)
}

if (!ROLES.includes(role)) {
  console.error(`"${role}" is not a role. Choose one of: ${ROLES.join(', ')}`)
  process.exit(1)
}

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..')

const env = {}
for (const line of readFileSync(join(backendDir, '.env'), 'utf8').split('\n')) {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) continue
  const eq = trimmed.indexOf('=')
  if (eq === -1) continue
  env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
}

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

/*
 * Everything below sets process.exitCode rather than calling process.exit().
 * Exiting hard while the Supabase client still holds open handles trips a libuv
 * assertion on Windows — the script has already done its work at that point, so
 * the crash is pure noise on top of a correct result.
 */
async function main() {
  // listUsers is paginated; a project with more accounts than one page needs
  // the loop rather than a single call.
  let user = null
  for (let page = 1; page <= 20 && !user; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) {
      console.error(`Could not list accounts: ${error.message}`)
      return 1
    }
    user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null
    if (data.users.length < 200) break
  }

  if (!user) {
    console.error(`No account for ${email}. Register at /register first.`)
    return 1
  }

  const { data, error } = await admin
    .from('profiles')
    .update({ role })
    .eq('id', user.id)
    .select('id, full_name, role')
    .maybeSingle()

  if (error) {
    console.error(`Could not set the role: ${error.message}`)
    return 1
  }
  if (!data) {
    console.error(
      'The account exists but has no profiles row. The signup trigger from 0001 did not run for it — delete the user and register again.',
    )
    return 1
  }

  console.log(`${email} is now ${data.role}.`)
  console.log('Sign out and back in for the app to pick it up.')
  return 0
}

process.exitCode = await main()
