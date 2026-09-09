#!/usr/bin/env node
/**
 * Creates a repeatable demo dataset, and removes it again.
 *
 *   npm run seed          populate
 *   npm run seed -- --reset   remove everything this script created
 *
 * Every row it writes is labelled DEMO, and every account uses the @tripti.demo
 * domain, so `--reset` can find its own work without guessing and without
 * touching anything real.
 *
 * Accounts are created through the Auth admin API rather than the registration
 * form because Supabase rejects addresses it considers untrustworthy — .test
 * and example.com among them — which makes the form unusable for scripted
 * setup. The form itself is unaffected; real signups go through it.
 *
 * The incident and the resource are created by calling the running API as a
 * signed-in user, not by inserting rows. That is the point: it exercises
 * extraction, need creation, the audit trail and every authorization check on
 * the way through, so a green run means the stack works end to end.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..')

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const env = {}
for (const line of readFileSync(join(backendDir, '.env'), 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const eq = t.indexOf('=')
  if (eq === -1) continue
  env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
}

const API = `http://localhost:${env.PORT || 4000}/api`
const DEMO_DOMAIN = 'tripti.demo'

/**
 * A shared, obvious, local-only password. This is demo data on a development
 * database — the value being guessable is the point, and nothing here should
 * ever exist in a real deployment.
 */
const DEMO_PASSWORD = 'demo-tripti-2026'

const ACCOUNTS = [
  { email: `coordinator@${DEMO_DOMAIN}`, name: 'DEMO Coordinator', role: 'coordinator' },
  { email: `volunteer@${DEMO_DOMAIN}`, name: 'DEMO Volunteer', role: 'volunteer' },
  { email: `donor@${DEMO_DOMAIN}`, name: 'DEMO Kitchen', role: 'donor', org: 'DEMO Community Kitchen' },
  { email: `citizen@${DEMO_DOMAIN}`, name: 'DEMO Citizen', role: 'citizen' },
]

const RESOURCES = [
  {
    label: 'DEMO — Cooked meals, Sector 18 kitchen',
    description: 'Vegetarian, packed in trays of 20. Collection from the rear gate.',
    kind: 'food',
    quantity: 400,
    unit: 'meals',
    address: 'Sector 18, Noida',
    lat: 28.5706,
    lon: 77.3272,
    perishable: true,
    expiry_time: new Date(Date.now() + 6 * 3600_000).toISOString(),
  },
  {
    label: 'DEMO — Drinking water, municipal depot',
    kind: 'water',
    quantity: 12_000,
    unit: 'litres',
    address: 'Okhla Phase II',
    lat: 28.5355,
    lon: 77.391,
    perishable: false,
  },
  {
    label: 'DEMO — Blankets, relief warehouse',
    kind: 'clothing',
    quantity: 850,
    unit: 'units',
    address: 'Ghaziabad',
    lat: 28.6692,
    lon: 77.4538,
    perishable: false,
  },
]

/**
 * A fleet, so assignment has something to rank and transport fit stops reading
 * "not assessed". One refrigerated van matters specifically: without it no
 * perishable load can be assigned at all.
 */
const VEHICLES = [
  {
    label: 'DEMO — Refrigerated van',
    type: 'van',
    capacity_units: 500,
    capacity_kg: 900,
    refrigerated: true,
    availability: 'available',
    lat: 28.5706,
    lon: 77.3272,
  },
  {
    label: 'DEMO — Flatbed truck',
    type: 'truck',
    capacity_units: 5000,
    capacity_kg: 4000,
    refrigerated: false,
    availability: 'available',
    lat: 28.5355,
    lon: 77.391,
  },
]

const VOLUNTEER_RECORD = {
  availability: 'available',
  skills: ['driving', 'lifting', 'local-knowledge'],
  max_concurrent_missions: 2,
  lat: 28.6,
  lon: 77.35,
  notes: 'DEMO volunteer. Available for the demo window.',
}

const REPORT =
  'Flooding near Sector 62 since last night. Around 300 people are stranded on upper floors, including elderly residents. Food and drinking water are urgently needed.'

const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})
const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
})

async function findDemoUsers() {
  const found = []
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(error.message)
    found.push(...data.users.filter((u) => u.email?.endsWith(`@${DEMO_DOMAIN}`)))
    if (data.users.length < 200) break
  }
  return found
}

async function reset() {
  console.log('Removing demo data…\n')

  const users = await findDemoUsers()
  const userIds = users.map((u) => u.id)

  /*
   * Order matters, and it is not obvious.
   *
   * Deleting an auth user cascades to its profile, but profiles are referenced
   * by incidents.reported_by, resources.owner_id, missions.created_by,
   * response_plans.created_by and status_history.changed_by — none of which
   * cascade. Postgres refuses the delete and Supabase reports it as the
   * unhelpfully generic "Database error deleting user". Everything a demo user
   * touched has to go first.
   */
  const removed = {}

  const { data: plans } = await admin
    .from('response_plans')
    .delete()
    .in('created_by', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000'])
    .select('id')
  removed.plans = plans?.length ?? 0

  const { data: resourceRows } = await admin
    .from('resources')
    .select('id')
    .like('label', 'DEMO —%')
  const resourceIds = (resourceRows ?? []).map((r) => r.id)

  if (resourceIds.length > 0) {
    const { data: missions } = await admin
      .from('missions')
      .delete()
      .in('resource_id', resourceIds)
      .select('id')
    removed.missions = missions?.length ?? 0
  }

  const { data: incidents } = await admin
    .from('incidents')
    .delete()
    .like('report_text', `%${REPORT.slice(0, 40)}%`)
    .select('id')
  removed.incidents = incidents?.length ?? 0

  const { data: resources } = await admin
    .from('resources')
    .delete()
    .like('label', 'DEMO —%')
    .select('id')
  removed.resources = resources?.length ?? 0

  const { data: vehicles } = await admin
    .from('vehicles')
    .delete()
    .like('label', 'DEMO —%')
    .select('id')
  removed.vehicles = vehicles?.length ?? 0

  if (userIds.length > 0) {
    // The audit trail is append-only during operations; a wholesale demo reset
    // is the one time its rows go with the data they describe, rather than
    // being left pointing at incidents that no longer exist.
    await admin.from('status_history').delete().in('changed_by', userIds)
    await admin.from('volunteers').delete().in('user_id', userIds)
  }

  for (const [what, count] of Object.entries(removed)) {
    console.log(`  ${GREEN}✔${RESET} ${what} removed ${DIM}(${count})${RESET}`)
  }

  // Counted, not assumed: the previous version printed the number of accounts
  // it tried to delete even when every one of them had just failed.
  let deleted = 0
  const failures = []
  for (const user of users) {
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) failures.push(`${user.email}: ${error.message}`)
    else deleted++
  }

  console.log(`  ${GREEN}✔${RESET} accounts removed ${DIM}(${deleted} of ${users.length})${RESET}`)
  for (const failure of failures) console.log(`  ${RED}x${RESET} ${failure}`)

  if (failures.length > 0) {
    console.log(`\n${RED}Some accounts could not be removed.${RESET} Something outside the demo data still references them.`)
    return 1
  }

  console.log('\nDemo data removed.')
  return 0
}

async function token(email) {
  const { data, error } = await anon.auth.signInWithPassword({
    email,
    password: DEMO_PASSWORD,
  })
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`)
  return data.session.access_token
}

async function call(path, accessToken, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  const parsed = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${parsed?.error ?? res.statusText}`)
  return parsed
}

async function callPut(path, accessToken, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  const parsed = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${parsed?.error ?? res.statusText}`)
  return parsed
}

async function seed() {
  console.log('Seeding demo data…\n')

  // Accounts. email_confirm bypasses the confirmation mail entirely, so this
  // works whether or not confirmation is switched on in the dashboard.
  const existing = await findDemoUsers()
  const byEmail = new Map(existing.map((u) => [u.email, u]))

  for (const account of ACCOUNTS) {
    let user = byEmail.get(account.email)

    if (!user) {
      const { data, error } = await admin.auth.admin.createUser({
        email: account.email,
        password: DEMO_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: account.name, org: account.org ?? null },
      })
      if (error) throw new Error(`${account.email}: ${error.message}`)
      user = data.user
    }

    // The signup trigger creates the profile as 'citizen'; the elevated roles
    // are granted here, which is the same path npm run set-role uses.
    const { error: roleError } = await admin
      .from('profiles')
      .update({ role: account.role, full_name: account.name, org: account.org ?? null })
      .eq('id', user.id)
    if (roleError) throw new Error(`${account.email} role: ${roleError.message}`)

    console.log(`  ${GREEN}✔${RESET} ${account.email} ${DIM}${account.role}${RESET}`)
  }

  // Resources, published by the donor through the real API.
  const donorToken = await token(`donor@${DEMO_DOMAIN}`)
  for (const resource of RESOURCES) {
    const { resource: created } = await call('/resources', donorToken, resource)
    console.log(
      `  ${GREEN}✔${RESET} ${created.label} ${DIM}${created.available_quantity ?? 'unmetered'} ${created.unit ?? ''}${RESET}`,
    )
  }

  // A fleet, owned by the volunteer, published through the real API.
  const volunteerToken = await token(`volunteer@${DEMO_DOMAIN}`)
  const vehicleIds = []
  for (const vehicle of VEHICLES) {
    const { vehicle: created } = await call('/vehicles', volunteerToken, vehicle)
    vehicleIds.push(created.id)
    console.log(
      `  ${GREEN}✔${RESET} ${created.label} ${DIM}${created.capacity_units} units${created.refrigerated ? ', refrigerated' : ''}${RESET}`,
    )
  }

  // The volunteer's own availability — the thing that makes them assignable.
  const { volunteer } = await callPut('/volunteers/me', volunteerToken, {
    ...VOLUNTEER_RECORD,
    vehicle_id: vehicleIds[0] ?? null,
  })
  console.log(
    `  ${GREEN}✔${RESET} volunteer availability ${DIM}${volunteer.availability}, ${volunteer.skills.length} skills${RESET}`,
  )

  // An incident, filed by the citizen through the real API — this runs
  // extraction, writes the needs, and appends to the audit trail.
  const citizenToken = await token(`citizen@${DEMO_DOMAIN}`)
  const result = await call('/incidents', citizenToken, {
    report_text: REPORT,
    lat: 28.6271,
    lon: 77.3716,
  })

  console.log(
    `  ${GREEN}✔${RESET} incident filed ${DIM}${result.source === 'model' ? `AI, confidence ${result.extraction.confidence}` : 'keyword fallback'}, ${result.extraction.needs.length} needs${RESET}`,
  )

  console.log(`\nDone. Sign in with any of these:\n`)
  for (const account of ACCOUNTS) {
    console.log(`  ${account.email.padEnd(28)} ${DEMO_PASSWORD}   ${DIM}${account.role}${RESET}`)
  }
  console.log(`\n${DIM}Remove it all with: npm run seed -- --reset${RESET}`)
}

try {
  if (process.argv.includes('--reset')) await reset()
  else await seed()
  process.exitCode = 0
} catch (err) {
  console.error(`\n${RED}Seed failed:${RESET} ${err.message}`)
  if (String(err.message).includes('fetch failed')) {
    console.error(`${DIM}Is the API running? npm run dev${RESET}`)
  }
  process.exitCode = 1
}
