# TRIPTI — Deployment

Three pieces, deployed separately.

| Piece | Platform | Config |
| --- | --- | --- |
| Database + Auth | Supabase | `supabase/migrations/` |
| API | Vercel — **its own project**, root `backend` | `backend/vercel.json` |
| Web app | Vercel — **its own project**, root `frontend` | `frontend/vercel.json` |

`render.yaml` is kept as an alternative host for the API and is equally valid;
§6 covers it.

**Two Vercel projects, not one.** They are separate deployments from the same
repository, each with its own root directory. The API holds the service role
key, which bypasses every RLS policy in the project and must never reach a
browser bundle — separate projects keep the two environments from ever sharing
a variable list by accident.

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

## 2. API on Vercel

New Project → same repository → **Root Directory: `backend`**. That one setting
is what separates this project from the web app; everything else comes from
`backend/vercel.json`.

### How an Express app runs serverless

`backend/api/index.js` default-exports the app that `createApp()` builds, and
Vercel's Node runtime treats a default-exported `(req, res)` function as the
handler. Every route, all middleware and the error handler behave exactly as
under `npm start` — there is one definition of what `/api/impact` means, in
`app.ts`, and both entry points use it.

It imports the **compiled** `../dist/app.js` rather than the TypeScript source.
The backend's tsconfig sets `rootDir: "src"`, so a `.ts` file in `api/` would
sit outside the project and go untypechecked by CI. `buildCommand` runs
`npm run build` first, so `dist` exists before the function is bundled.

`public/index.html` is served at `/` and also satisfies Vercel's requirement
that a project with a build command produce a static output directory.

### Environment variables

| Variable | Notes |
| --- | --- |
| `SUPABASE_URL` | |
| `SUPABASE_ANON_KEY` | |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS. Rotate immediately if it leaks. |
| `ANTHROPIC_API_KEY` | Optional — omit and extraction uses the fallback |
| `CORS_ORIGINS` | **Must** list the web app's Vercel origin |

`CORS_ORIGINS` is the one that will bite, and it cannot be set correctly until
the web app exists — see §4.

Verify with `https://<api>.vercel.app/health` → `{"status":"ok"}`.

### What serverless changes

Named rather than discovered later:

- **Rate limits become per-instance.** `express-rate-limit` holds its buckets in
  memory, and every warm instance has its own. The documented ceilings are no
  longer global. A shared store is required before this matters.
- **Cold starts.** The first request to an idle instance pays for importing the
  app and validating the environment. `maxDuration` is raised to 30s so that
  plus a Supabase round trip cannot hit the default 10s ceiling.
- **Nothing may be written to disk.** The app does not, but anything added
  later must not either.
- **`config.ts` throws at cold start when the environment is incomplete**, which
  surfaces as a 500 rather than a failed boot. Loud, but check the function log
  rather than the deploy log.

## 3. Web app on Vercel

A **second** Vercel project from the same repository → **Root Directory:
`frontend`**.

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | same project as the API |
| `VITE_SUPABASE_ANON_KEY` | public by design; it ships in the bundle |
| `VITE_API_BASE_URL` | `https://<api>.vercel.app/api` — **including `/api`** |

Only `VITE_`-prefixed variables reach the bundle, and everything there is public
by design. The service role key belongs in the API project, never here — a
`VITE_` prefix on it would inline it into JavaScript every visitor downloads and
void every RLS policy in the project.

### The build guard, and why it exists

`frontend/vite.config.ts` fails the build when `VITE_SUPABASE_*` is missing **or
still a placeholder**. Do not remove it.

Vite substitutes `import.meta.env.VITE_*` with string literals at build time.
With them unset, `isSupabaseConfigured` became a static `false`, and the
bundler then eliminated the entire application as dead code. Production shipped
a 352 KB stub of an empty page **for three phases** while every check stayed
green. The real bundle is around 460 KB plus lazy chunks.

That guard turns a silent, invisible failure into a loud one.

A missing `VITE_API_BASE_URL` warns rather than fails, because serving behind a
proxy that forwards `/api` is legitimate. On Vercel it is not: the SPA rewrite
deliberately excludes `api/`, so an unset value produces a clean 404 on every
data call instead of an HTML page arriving where JSON was expected.

---

## 4. The ordering problem

The two projects each need the other's URL, so one pass cannot set both.

1. **Deploy the API first.** Set `CORS_ORIGINS` to anything for now — the value
   is wrong until step 3 and nothing depends on it yet.
2. **Deploy the web app**, with `VITE_API_BASE_URL` pointing at the API from
   step 1. Note the URL Vercel assigns it.
3. **Go back to the API project**, set `CORS_ORIGINS` to that URL, and
   redeploy.

Until step 3 the app loads and every request fails. The browser reports a
network or CORS error rather than a configuration one, so this is worth doing in
order rather than debugging afterwards.

Use the project's stable production domain, not a per-deployment preview URL —
preview URLs change on every push, and each one is a different origin that
`CORS_ORIGINS` will not match.

---

## 5. After deploying

```bash
npm run health                    # against the deployed project
npm run set-role you@example.com coordinator
```

Then sign in and walk the demo path in `DEMO.md`. A deploy is not verified
because it built; it is verified because a report went in one end and a mission
came out the other.

---

## 6. Alternative: the API on Render

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

## 7. Checklist

- [ ] All seven migration steps applied, in order
- [ ] **Two** Vercel projects, root directories `backend` and `frontend`
- [ ] `VITE_API_BASE_URL` points at the API, including `/api`
- [ ] `CORS_ORIGINS` set to the web app's production domain, and the API
      redeployed **after** setting it
- [ ] Frontend and backend name the **same** Supabase project — compare the
      project refs character by character. A hand-typed ref that differed by one
      character produced confusing failures for an afternoon; `npm run health`
      now checks this explicitly.
- [ ] Service role key set on the API project only, never in a `VITE_` variable
- [ ] At least one account promoted to `coordinator`
- [ ] `/health` returns `{"status":"ok"}`
- [ ] A real report submitted through the deployed UI reaches the board
