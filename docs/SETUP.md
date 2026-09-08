# TRIPTI — Supabase setup

From a fresh Supabase project to a running, verified stack. Roughly ten minutes.

Run `npm run health` at the end — it checks the things that fail silently, like
a migration that was skipped or a table the browser can read that it must not.

---

## 1. Install

```bash
npm run install:all
```

---

## 2. Run the migrations

```bash
npm run db:bundle
```

That writes two files. Supabase dashboard → **SQL Editor** → *New query* →
paste `supabase/bundle/step-1.sql`, run it, then do the same with `step-2.sql`.

Two blocks rather than one because `0002` adds the enum value `'ngo'`, and
Postgres refuses to *use* a new enum value until the transaction that added it
has committed — `0003` and `0004` reference it in policy expressions. Running
everything at once fails with `unsafe use of new value "ngo" of enum type
user_role`.

The bundles are generated from `supabase/migrations/`, which stays the source of
truth. Running each migration separately works too:

| Order | File | What it creates |
| ----- | ---- | --------------- |
| 1 | `0001_init.sql` | Enums, profiles, incidents, needs, resources, missions, status_history, RLS, realtime |
| 2 | `0002_roles.sql` | Renames `viewer` → `citizen`, adds `ngo` |
| 3 | `0003_auth_and_integrity.sql` | Role pinning, `updated_at` triggers, PII split, signup roles |
| 4 | `0004_operations.sql` | Volunteers, vehicles, matches, mission stops, routes, impact metrics, notifications |
| 5 | `0005_extraction_provenance.sql` | Records whether a model or the fallback produced each extraction |

> **`0002` must be its own query, run and committed before `0003`.** Postgres
> refuses to *use* an enum value in the same transaction that added it, and
> `0003` references `'ngo'`. Running them together fails with
> `unsafe use of new value "ngo" of enum type user_role`.

Each script should end with `Success. No rows returned`.

---

## 3. Collect the keys

Dashboard → **Project Settings → API Keys**.

| You need | Where | Goes in |
| -------- | ----- | ------- |
| Project URL | Settings → API (or the top of the project home) | both env files |
| Publishable / `anon` key | API Keys | both env files |
| Secret / `service_role` key | API Keys → *Reveal* | `backend/.env` **only** |

Newer projects show `sb_publishable_…` and `sb_secret_…`; older ones show `anon`
and `service_role`. Either pair works — the publishable one is the browser key,
the secret one is the server key.

**The secret key bypasses row level security completely.** It never goes in a
`VITE_` variable, a frontend file, or a commit. If it leaks, rotate it in the
dashboard immediately.

### The Anthropic key is optional

An **Anthropic API key** from [console.anthropic.com](https://console.anthropic.com)
gives you real extraction: a report in any language becomes a category,
severity, headcount, needs and a confidence score.

**You can finish this setup without one.** Leave `ANTHROPIC_API_KEY` unset and
extraction falls back to the deterministic keyword scan in `ai/fallback.ts` —
the same path that covers an API outage. Reports are still accepted, matching
and missions still work, and every incident is marked `ai_source: fallback` with
`confidence: 0` so a coordinator knows nothing has read it. The server says so
loudly at boot.

The API is paid — there is no free tier, though new accounts may carry trial
credit (check Billing in the console). At Opus 5 rates a report costs roughly
**$0.02**, so a demo costs cents.

---

## 4. Write the env files

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

`backend/.env`:

```
SUPABASE_URL=https://<your-ref>.supabase.co
SUPABASE_ANON_KEY=<publishable key>
SUPABASE_SERVICE_ROLE_KEY=<secret key>
CORS_ORIGINS=http://localhost:5173

# Optional — omit this line entirely to run on the keyword fallback.
ANTHROPIC_API_KEY=sk-ant-...
```

`frontend/.env.local`:

```
VITE_SUPABASE_URL=https://<your-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable key>
```

Both are gitignored. Only `VITE_`-prefixed variables reach the browser bundle,
and everything in the frontend file is public by design.

> Vite inlines `VITE_` variables at build time, so `npm run build` fails without
> them rather than emitting a bundle that can only show the setup screen. See
> D12 in the gap analysis for why that guard exists.

---

## 5. Let accounts sign in immediately (development only)

Dashboard → **Authentication → Sign In / Providers → Email** → turn
**Confirm email** off.

With confirmation on, registration succeeds but no session is created until the
emailed link is clicked, and Supabase's built-in mailer is rate limited to a
handful of messages an hour. Turn it back on before anything real.

---

## 6. Run it

```bash
npm run dev
```

- API → http://localhost:4000
- Web → http://localhost:5173

---

## 7. Create an account and promote it

Register at http://localhost:5173/register. Signup only offers the four
self-service roles — `coordinator` and `admin` are granted, never chosen, and
three separate mechanisms enforce that (the form, `handle_new_user()`, and the
`profiles_pin_role` trigger).

To make yourself a coordinator, run this in the SQL Editor:

```sql
update profiles
set role = 'coordinator'
where id = (select id from auth.users where email = 'you@example.com');
```

That works from the SQL Editor because `auth.uid()` is null there, which is the
one path the role-pinning trigger deliberately allows. The same change is
impossible with your own session token.

Sign out and back in so the app reloads your role.

---

## 8. Verify

```bash
npm run health
```

It checks that every migration actually applied (tables **and** the columns
later migrations add — a table can exist while its `ALTER`s did not run), that
the role enum has `citizen` and `ngo`, that a coordinator exists, that the API
answers on `/health`, and — the one that matters most — that the anon key
**cannot** read `incident_contacts` or any incident.

A clean run ends with `All required checks passed.`

---

## Troubleshooting

**`unsafe use of new value "ngo" of enum type user_role`**
`0002` and `0003` were run in the same query. Run `0002` alone first.

**`infinite recursion detected in policy for relation "profiles"`**
`0003` has not been applied. It replaces the recursive policy from `0001`.

**"No ANTHROPIC_API_KEY set — running with keyword extraction only"**
Expected when you have not added a key. Everything works; extraction is
keyword-based and every incident is flagged for manual triage.

**Backend exits with "Invalid environment configuration"**
`backend/.env` is incomplete; the message names the missing keys. The Anthropic
key is never one of them — it is optional. This is
deliberate — a half-configured server in a disaster-response tool is worse than
one that refuses to start.

**The app shows "TRIPTI is not configured yet"**
`frontend/.env.local` is missing or incomplete. Restart Vite afterwards; env
changes are not hot-reloaded.

**Signed in, but every operator screen says the role could not be confirmed**
`GET /api/profile` failed, so the browser has no authoritative role and fails
closed. Usually the API is not running.

**`403 No profile for this account`**
The auth user exists but has no `profiles` row — the account was created before
`0001` installed the signup trigger. Delete the user and register again.
