#!/usr/bin/env node
/**
 * Verifies that a TRIPTI environment is actually wired up.
 *
 * Checks the things that fail silently: a migration that was skipped, an enum
 * that never got its new values, a table the browser can read that it must not.
 * Run it after setting up Supabase, and again after any deploy.
 *
 *   npm run health
 *
 * Exits non-zero if anything required is wrong, so CI or a deploy step can gate
 * on it.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..')

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

let failures = 0
let warnings = 0

function pass(label, detail = '') {
  console.log(`  ${GREEN}✔${RESET} ${label}${detail ? ` ${DIM}${detail}${RESET}` : ''}`)
}

function fail(label, detail = '') {
  failures++
  console.log(`  ${RED}x${RESET} ${label}${detail ? `\n      ${DIM}${detail}${RESET}` : ''}`)
}

function warn(label, detail = '') {
  warnings++
  console.log(`  ${YELLOW}!${RESET} ${label}${detail ? ` ${DIM}${detail}${RESET}` : ''}`)
}

function section(title) {
  console.log(`\n${title}`)
}

/** Minimal .env reader — no dependency, and it never overwrites a real env var. */
function readEnvFile(path) {
  try {
    const values = {}
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      values[trimmed.slice(0, eq).trim()] = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
    }
    return values
  } catch {
    return null
  }
}

console.log('TRIPTI health check')

// ------------------------------------------------------------------ env

section('Environment')

const backendEnv = readEnvFile(join(backendDir, '.env'))
if (!backendEnv) {
  fail('backend/.env is missing', 'Copy backend/.env.example to backend/.env and fill it in.')
  process.exit(1)
}

const env = { ...backendEnv, ...process.env }

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']

const isPlaceholder = (value) =>
  !value || value.startsWith('your-') || value.includes('your-project')

for (const key of REQUIRED) {
  if (isPlaceholder(env[key])) {
    fail(`${key} is not set`, 'Still holding the placeholder from .env.example.')
  } else {
    pass(key, `${env[key].slice(0, 8)}…`)
  }
}

// Optional. Without it the app runs on the deterministic keyword fallback —
// degraded, but working, which is why this is a warning and not a failure.
if (isPlaceholder(env.ANTHROPIC_API_KEY)) {
  warn(
    'ANTHROPIC_API_KEY is not set',
    'Extraction falls back to a keyword scan; incidents are flagged for manual triage.',
  )
} else {
  pass('ANTHROPIC_API_KEY', `${env.ANTHROPIC_API_KEY.slice(0, 8)}…`)
}

if (failures > 0) {
  console.log(`\n${RED}Cannot continue without the environment.${RESET}`)
  process.exit(1)
}

// The two keys are different lengths and roles; swapping them is a common and
// confusing mistake, and it fails much later with a permissions error.
if (env.SUPABASE_ANON_KEY === env.SUPABASE_SERVICE_ROLE_KEY) {
  fail('The anon key and service role key are identical', 'They are different keys — recopy them.')
}

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
})

// -------------------------------------------------------------- schema

section('Schema — every migration applied')

/** Returns an error message when the table is missing or unreachable. */
async function tableError(table) {
  const { error } = await admin.from(table).select('*', { head: true, count: 'exact' })
  return error ? error.message : null
}

/** Returns an error message when the column is missing — catches a half-applied migration. */
async function columnError(table, column) {
  const { error } = await admin.from(table).select(column, { head: true })
  return error ? error.message : null
}

const TABLES = {
  '0001': ['profiles', 'incidents', 'needs', 'resources', 'missions', 'status_history'],
  '0003': ['incident_contacts'],
  '0004': [
    'volunteers',
    'vehicles',
    'matches',
    'mission_stops',
    'routes',
    'impact_metrics',
    'notifications',
  ],
}

for (const [migration, tables] of Object.entries(TABLES)) {
  for (const table of tables) {
    const error = await tableError(table)
    if (error) fail(`table ${table}`, `${error} — migration ${migration} not applied?`)
    else pass(`table ${table}`, `(${migration})`)
  }
}

// Columns added by later migrations. A table can exist while its ALTERs did not
// run, which is exactly the failure a table-only check misses.
const COLUMNS = [
  ['resources', 'reserved_quantity', '0004'],
  ['resources', 'expiry_time', '0004'],
  ['incidents', 'ai_source', '0005'],
  ['incidents', 'vulnerable_groups', '0005'],
]

for (const [table, column, migration] of COLUMNS) {
  const error = await columnError(table, column)
  if (error) fail(`${table}.${column}`, `migration ${migration} not applied`)
  else pass(`${table}.${column}`, `(${migration})`)
}

// reporter_phone must be *gone* — it moved to incident_contacts in 0003. Here an
// error is the passing outcome, because it means the column is no longer there.
const phoneStillPresent = (await columnError('incidents', 'reporter_phone')) === null
if (phoneStillPresent) {
  fail('incidents.reporter_phone still exists', 'Migration 0003 did not run its PII split.')
} else {
  pass('incidents.reporter_phone removed', '(0003)')
}

// ---------------------------------------------------------------- roles

section('Roles')

const { error: roleError } = await admin.from('profiles').select('id').eq('role', 'ngo').limit(1)
if (roleError) {
  fail("user_role is missing 'ngo'", `${roleError.message} — migration 0002 not applied?`)
} else {
  pass("user_role accepts 'ngo'", '(0002)')
}

const { error: citizenError } = await admin
  .from('profiles')
  .select('id')
  .eq('role', 'citizen')
  .limit(1)
if (citizenError) {
  fail("user_role is missing 'citizen'", 'Migration 0002 renames viewer to citizen.')
} else {
  pass("user_role accepts 'citizen'", '(0002)')
}

const { data: staff } = await admin
  .from('profiles')
  .select('id')
  .in('role', ['coordinator', 'admin'])
  .limit(1)

if (!staff || staff.length === 0) {
  warn(
    'No coordinator or admin account exists yet',
    'Triage and matching screens stay locked until one does.',
  )
} else {
  pass('At least one coordinator or admin exists')
}

// ------------------------------------------------------------- security

section('Security — the browser must not reach these')

/*
 * The important one. incident_contacts has RLS enabled and no policies at all,
 * so the anon key must return nothing. If this ever passes rows, reporter phone
 * numbers are readable by anyone who opens the browser console.
 */
const { data: leakedContacts, error: contactsError } = await anon
  .from('incident_contacts')
  .select('reporter_phone')
  .limit(1)

if (contactsError || !leakedContacts || leakedContacts.length === 0) {
  pass('incident_contacts is unreachable with the anon key')
} else {
  fail(
    'incident_contacts LEAKS reporter phone numbers to the anon key',
    'RLS is off or a policy was added. Fix before deploying.',
  )
}

// An unauthenticated browser should see no incidents at all.
const { data: leakedIncidents } = await anon.from('incidents').select('id').limit(1)
if (!leakedIncidents || leakedIncidents.length === 0) {
  pass('incidents are not readable without signing in')
} else {
  fail('incidents are readable by an anonymous client', 'Check the RLS policy from 0003.')
}

// --------------------------------------------------------------- backend

section('Backend')

const port = env.PORT || '4000'
try {
  const response = await fetch(`http://localhost:${port}/health`, {
    signal: AbortSignal.timeout(3000),
  })
  const body = await response.json()
  if (response.ok && body.status === 'ok') pass(`GET /health on :${port}`, 'status ok')
  else fail(`GET /health on :${port}`, `Unexpected response: ${JSON.stringify(body)}`)
} catch {
  warn(`API not running on :${port}`, 'Start it with npm run dev, then re-run this check.')
}

// ---------------------------------------------------------------- result

console.log('')
if (failures > 0) {
  console.log(`${RED}${failures} check(s) failed.${RESET} ${warnings} warning(s).`)
  process.exit(1)
}
console.log(`${GREEN}All required checks passed.${RESET} ${warnings} warning(s).`)
