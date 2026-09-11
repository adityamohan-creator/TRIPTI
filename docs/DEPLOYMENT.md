# TRIPTI — Deployment

**One Vercel project, two services, one origin.**

| Piece | Where | Config |
| --- | --- | --- |
| Database + Auth | Supabase | `supabase/migrations/` |
| Web app — served at `/` | Vercel service `web` | root `vercel.json` |
| API — served at `/api` | Vercel service `api` | root `vercel.json` |

Vercel Services build each service separately and route between them with
top-level rewrites. The important consequence is that **the browser never makes
a cross-origin request**, which deletes the two settings most likely to be got
wrong:

- **No `CORS_ORIGINS` to coordinate.** Same origin, so there is no preflight
  and nothing to keep in sync with a deployment URL.
- **No `VITE_API_BASE_URL` to set.** The client's default is `/api`, which is
  already correct — and it mirrors local dev, where Vite proxies `/api` to
  `:4000`. One code path, both environments.

A service receives the **original** request path, so `/api/impact` arrives at
the API as `/api/impact`. The routers mounted at `/api` in `app.ts` match
unchanged; nothing is stripped and no compatibility shim is needed.

`render.yaml` remains a working alternative for hosting the API separately;
§6 covers it and what changes if you use it.

---

## 1. Database

Migrations are applied by pasting the generated bundles into the Supabase SQL
Editor, in order.

```bash
npm run db:bundle
```

That writes seven files to `supabase/bundle/`. Run them **one at a time, in
order, letting each finish**. The split is not cosmetic — `0002` adds an enum
value and Postgres refuses to *use* a new enum value until the transaction that
added it has committed, so steps that reference it must run separately.

Step 7 (`0012`) adds the reporting indexes and the note on `impact_metrics`. The
app works without it; the impact queries are just unindexed.

`supabase/bundle/` is generated and gitignored. The source of truth is
`supabase/migrations/`. A migration not wired into a step in
`scripts/bundle-migrations.mjs` makes the bundler fail loudly rather than
letting anyone silently skip it.

---

## 2. Deploying

Import `adityamohan-creator/TRIPTI` at **vercel.com/new**. Vercel reads the
root `vercel.json`, detects both services and wires the routing itself — leave
Root Directory at `./`, and do not set a framework preset. The import screen
should list `frontend` at `/` and `backend` at `/api`.

### Environment variables

Variables are shared across services in one project, so these are set once:

| Variable | Notes |
| --- | --- |
| `SUPABASE_URL` | |
| `SUPABASE_ANON_KEY` | |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS. Rotate immediately if it leaks. |
| `VITE_SUPABASE_URL` | Same value as `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | Same value as `SUPABASE_ANON_KEY` |
| `ANTHROPIC_API_KEY` | Optional — omit and extraction uses the fallback |

**Do not set `VITE_API_BASE_URL`.** Unset is correct here; setting it replaces
a working same-origin path with a cross-origin one that then needs CORS.

`CORS_ORIGINS` is not needed either. It has a safe default and nothing
cross-origin reaches the API.

Only `VITE_`-prefixed variables are inlined into the browser bundle. The
service role key must never carry that prefix — it would ship to every visitor
and void every RLS policy in the project.

### How each service is built

**`web`** — Vite, `npm run build`, output `dist`.

**`api`** — `npm run build` (tsc), then Vercel runs `dist/server.js`: the same
entry point `npm start` uses. There is no serverless wrapper and no second
definition of any route. `server.ts` already listens on `process.env.PORT`,
which Vercel assigns.

Verify with `https://<your-project>.vercel.app/health` → `{"status":"ok"}`.

### What hosting changes

Named rather than discovered later:

- **Rate limits become per-instance.** `express-rate-limit` holds buckets in
  memory and service backends run as functions on Fluid compute, so the
  documented ceilings are no longer global across instances. A shared store is
  required before that matters.
- **Cold starts.** The first request to an idle instance pays for importing the
  app and validating the environment.
- **Nothing may be written to disk.** The app does not; anything added later
  must not either.
- **`config.ts` throws at startup when the environment is incomplete**, which
  surfaces as a 500. Loud, but read the function log, not the build log.

---

## 3. The build guard, and why it exists

`frontend/vite.config.ts` fails the build when `VITE_SUPABASE_*` is missing
**or still a placeholder**. Do not remove it.

Vite substitutes `import.meta.env.VITE_*` with string literals at build time.
With them unset, `isSupabaseConfigured` became a static `false`, and the
bundler then eliminated the entire application as dead code. Production shipped
a 352 KB stub of an empty page **for three phases** while every check stayed
green. The real bundle is around 460 KB plus lazy chunks.

That guard turns a silent, invisible failure into a loud one.

---

## 4. After deploying

```bash
npm run health                    # against the deployed project
npm run set-role you@example.com coordinator
```

Then sign in and walk the demo path in `DEMO.md`. A deploy is not verified
because it built; it is verified because a report went in one end and a mission
came out the other.

---

## 5. Alternative: the API on Render

`render.yaml` is a Render blueprint for the same API, kept because a
long-running server is what the code actually assumes — in particular the
in-process rate limiter, whose ceilings are global on one instance and
per-instance on serverless.

Point Render at the repository and it reads the blueprint: `rootDir: backend`,
`npm ci && npm run build`, `npm start`, health check `/health`. The environment
variables are the same as §2, all marked `sync: false` so Render prompts for
them and stores them encrypted rather than reading them from the file.

The free tier sleeps after inactivity, so the first request after a quiet period
takes 30–50 seconds.

Nothing else changes: `VITE_API_BASE_URL` points at the Render URL instead, and
`CORS_ORIGINS` still names the web app's origin.

---

## 6. Checklist

- [ ] All seven migration steps applied, in order
- [ ] Imported at repository root — Root Directory `./`, no framework preset
- [ ] Import screen shows both services: `frontend` at `/`, `backend` at `/api`
- [ ] Both `SUPABASE_*` and both `VITE_SUPABASE_*` variables set
- [ ] `VITE_API_BASE_URL` **not** set
- [ ] Service role key set without a `VITE_` prefix
- [ ] `/health` returns `{"status":"ok"}`
- [ ] At least one account promoted to `coordinator`
- [ ] A real report submitted through the deployed UI reaches the board
