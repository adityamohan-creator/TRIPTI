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
  {
    email: `ngo@${DEMO_DOMAIN}`,
    name: 'DEMO Relief Trust',
    role: 'ngo',
    org: 'DEMO Relief Trust',
  },
]

const RESOURCES = [
  {
    label: 'DEMO — Cooked meals, Sector 18 kitchen',
    description: 'Vegetarian, packed in trays of 20. Collection from the rear gate.',
    kind: 'food',
    quantity: 4_000,
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
    quantity: 60_000,
    unit: 'litres',
    address: 'Okhla Phase II',
    lat: 28.5355,
    lon: 77.391,
    perishable: false,
  },
  {
    label: 'DEMO — Blankets, relief warehouse',
    kind: 'clothing',
    quantity: 3_500,
    unit: 'units',
    address: 'Ghaziabad',
    lat: 28.6692,
    lon: 77.4538,
    perishable: false,
  },
  {
    label: 'DEMO — Rescue team, district response unit',
    description: 'Six trained responders with boats. Unmetered — a team, not a quantity.',
    kind: 'rescue',
    quantity: null,
    unit: null,
    address: 'Sector 62, Noida',
    lat: 28.6271,
    lon: 77.3716,
    perishable: false,
  },
  {
    label: 'DEMO — Medical supplies, partner clinic',
    kind: 'medical',
    quantity: 900,
    unit: 'kits',
    address: 'Mayur Vihar',
    lat: 28.6094,
    lon: 77.2952,
    perishable: false,
  },
  {
    label: 'DEMO — Surplus bread, bakery chain',
    description: 'Close to date. The food-rescue case: it feeds people or it is thrown away.',
    kind: 'food',
    quantity: 620,
    unit: 'kg',
    address: 'Laxmi Nagar',
    lat: 28.6304,
    lon: 77.2777,
    perishable: true,
    expiry_time: new Date(Date.now() + 3 * 3600_000).toISOString(),
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

/**
 * The scenario, as a set of reports.
 *
 * Written the way a person actually phones one in — no structure, uneven
 * detail, and a headcount sometimes stated and sometimes not.
 *
 * `triage` is what a coordinator fills in afterwards. Extraction never invents
 * a headcount, so without that pass every impact figure reads zero however
 * much was delivered.
 */
const INCIDENTS = [
  {
    report_text:
      'Flooding near Sector 62 since last night. Around 2,400 people are stranded on upper floors, including elderly residents. Food and drinking water are urgently needed.',
    lat: 28.6271,
    lon: 77.3716,
    triage: { severity: 'critical', people_affected: 2400, status: 'triaged' },
  },
  {
    report_text:
      'Dam overflow upstream. Whole colony cut off, no drinking water since yesterday morning. Roughly 4,000 affected. Boats needed, some people still on rooftops.',
    lat: 28.6692,
    lon: 77.4538,
    triage: { severity: 'critical', people_affected: 4000, status: 'triaged' },
  },
  {
    report_text:
      'Shelter roof collapsed overnight in freezing conditions. 1,200 people moved to the school hall. They need blankets and warm food tonight.',
    lat: 28.6094,
    lon: 77.2952,
    triage: { severity: 'high', people_affected: 1200, status: 'triaged' },
  },
  {
    report_text:
      'Relief camp at the community centre has been running three days. About 800 staying. Meals holding out but water is getting low.',
    lat: 28.5706,
    lon: 77.3272,
    triage: { severity: 'high', people_affected: 800, status: 'triaged' },
  },
  {
    report_text:
      'Some households on this street need warm clothes and blankets tonight. Maybe forty or fifty people, mostly families with small children.',
    lat: 28.6304,
    lon: 77.2777,
    triage: { severity: 'medium', people_affected: 45, status: 'triaged' },
  },
  {
    report_text:
      'Minor waterlogging on a side street. A few households say they could use drinking water but nobody is in danger.',
    lat: 28.5355,
    lon: 77.391,
    triage: { severity: 'low', people_affected: 25, status: 'triaged' },
  },
]

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

async function reset({ quiet = false } = {}) {
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

  /*
   * Matched on who filed them, not on their text. The scenario is six separate
   * reports now, and matching one string would have left five behind — with
   * their needs, matches and missions still on the board after a reset that
   * claimed to have cleared it.
   */
  const { data: incidents } = await admin
    .from('incidents')
    .delete()
    .in('reported_by', userIds.length ? userIds : ['00000000-0000-0000-0000-000000000000'])
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
    /*
     * Reallocations reference profiles with no cascade rule, so a single
     * proposal left behind makes deleting the coordinator fail with nothing
     * more specific than "Database error deleting user" — a reset that reports
     * success while leaving the account in place.
     */
    await admin.from('reallocations').delete().in('created_by', userIds)

    await admin.from('status_history').delete().in('changed_by', userIds)
    await admin.from('volunteers').delete().in('user_id', userIds)
  }

  for (const [what, count] of Object.entries(removed)) {
    if (!quiet) console.log(`  ${GREEN}✔${RESET} ${what} removed ${DIM}(${count})${RESET}`)
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

  if (!quiet) {
    console.log(`  ${GREEN}✔${RESET} accounts removed ${DIM}(${deleted} of ${users.length})${RESET}`)
  }
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

/**
 * Waits out a rate limit rather than failing the seed.
 *
 * Seeding is a legitimate bulk operation against limits written for a single
 * person clicking — six reports in as many seconds is exactly the shape the
 * intake limiter exists to refuse. Backing off and retrying respects the limit
 * instead of weakening it, and a seed that dies half-finished leaves the
 * database in a state nobody asked for.
 */
async function withRetry(fn, label) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn()
    } catch (err) {
      const limited = String(err.message).includes('429')
      if (!limited || attempt >= 2) throw err
      const wait = 20_000
      console.log(`  ${DIM}rate limited on ${label}; waiting ${wait / 1000}s${RESET}`)
      await new Promise((r) => setTimeout(r, wait))
    }
  }
}

async function callPatch(path, accessToken, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`PATCH ${path} -> ${res.status} ${text.slice(0, 200)}`)
  return text ? JSON.parse(text) : null
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
  /*
   * Always clear first. A seed exists to produce one known state, and running
   * it twice produced two of everything — twelve incidents, doubled
   * headcounts, an impact figure that was simply wrong. Nobody runs a seed
   * script exactly once while preparing a demo.
   *
   * Safe because reset only removes what this script created: resources and
   * vehicles labelled DEMO, incidents filed by the demo accounts, and the
   * accounts themselves.
   */
  await reset({ quiet: true })

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
    const { resource: created } = await withRetry(
      () => call('/resources', donorToken, resource),
      'resource',
    )
    console.log(
      `  ${GREEN}✔${RESET} ${created.label} ${DIM}${created.available_quantity ?? 'unmetered'} ${created.unit ?? ''}${RESET}`,
    )
  }

  // A fleet, owned by the volunteer, published through the real API.
  const volunteerToken = await token(`volunteer@${DEMO_DOMAIN}`)
  const vehicleIds = []
  for (const vehicle of VEHICLES) {
    const { vehicle: created } = await withRetry(
      () => call('/vehicles', volunteerToken, vehicle),
      'vehicle',
    )
    vehicleIds.push(created.id)
    console.log(
      `  ${GREEN}✔${RESET} ${created.label} ${DIM}${created.capacity_units} units${created.refrigerated ? ', refrigerated' : ''}${RESET}`,
    )
  }

  // The volunteer's own availability — the thing that makes them assignable.
  const { volunteer } = await withRetry(
    () =>
      callPut('/volunteers/me', volunteerToken, {
    ...VOLUNTEER_RECORD,
        vehicle_id: vehicleIds[0] ?? null,
      }),
    'volunteer availability',
  )
  console.log(
    `  ${GREEN}✔${RESET} volunteer availability ${DIM}${volunteer.availability}, ${volunteer.skills.length} skills${RESET}`,
  )

  /*
   * Incidents, filed by the citizen through the real API so extraction runs,
   * needs are written and the audit trail is appended — then triaged by the
   * coordinator, exactly as a person would.
   */
  const citizenToken = await token(`citizen@${DEMO_DOMAIN}`)
  const coordinatorToken = await token(`coordinator@${DEMO_DOMAIN}`)
  let modelRead = 0

  for (const incident of INCIDENTS) {
    const result = await withRetry(
      () =>
        call('/incidents', citizenToken, {
          report_text: incident.report_text,
          lat: incident.lat,
          lon: incident.lon,
        }),
      'incident intake',
    )
    if (result.source === 'model') modelRead += 1

    /*
     * The triage pass. `people_affected` is the important one: extraction
     * refuses to guess a headcount, so until a coordinator supplies it every
     * impact figure reads zero no matter how much was delivered.
     */
    await withRetry(
      () => callPatch(`/incidents/${result.incident.id}`, coordinatorToken, incident.triage),
      'triage',
    )

    console.log(
      `  ${GREEN}✔${RESET} ${incident.report_text.slice(0, 44)}… ${DIM}${incident.triage.severity}, ${incident.triage.people_affected.toLocaleString()} affected${RESET}`,
    )
  }

  console.log(
    `
  ${DIM}${modelRead} of ${INCIDENTS.length} read by the model; ${INCIDENTS.length - modelRead} by the keyword fallback.${RESET}`,
  )
  if (modelRead === 0) {
    console.log(`  ${DIM}Set ANTHROPIC_API_KEY to have the model read them instead.${RESET}`)
  }

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
