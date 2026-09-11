# TRIPTI — Deployment

Three pieces, three places.

| Piece | Platform | Config |
| --- | --- | --- |
| Database + Auth | Supabase | `supabase/migrations/` |
| API | Render | `render.yaml` |
| Web app | Vercel — root directory **`frontend`** | `frontend/vercel.json` |

The API and the web app are split deliberately. The API holds the service role
key, which bypasses every RLS policy in the project and must never be built into
anything a browser downloads. Keeping them on separate platforms makes that
boundary a deployment fact rather than a convention someone has to remember.

> **The API is a long-running Express server, not serverless.** `render.yaml`
> runs `npm start` → `node dist/server.js`. Do not deploy the backend to Vercel:
> `express-rate-limit` keeps its buckets in process, and the documented ceilings
> are only global on a single long-lived instance. §7 has the full reasoning.

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

## 2. API on Render

**Deploy this first.** Vercel needs the API's URL.

There is nothing to upload. A Render blueprint is read from the repository, so
either use the **Deploy to Render** button in the README, or go to
**New → Blueprint** and select the repo. Both read `render.yaml`, so the build
settings are already correct:

| Setting | Value |
| --- | --- |
| Root directory | `backend` |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` (→ `node dist/server.js`) |
| Health check | `/health` |
| Auto deploy | on every commit to `main` (`autoDeployTrigger: commit`) |

`npm ci` rather than `npm install`: a deploy must build the lockfile's tree, not
whatever resolves that morning.

`--include=dev` is not optional. `NODE_ENV=production` is set on the service,
npm reads it at install time and omits devDependencies — and that is where
`typescript`, `@types/express` and `@types/node` live. Without them the build
either cannot find `tsc`, or runs it with no Express type definitions and
reports every `req`, `res` and `next` in every router as an implicit `any`
(TS7006). The errors name the route files, so they read like a code problem.
They are an install problem, and no amount of annotating handler parameters
fixes them — those annotations are imported from the very package that is
missing.

The runtime needs none of it: `npm start` runs compiled JavaScript.

Every secret is marked `sync: false`, so Render prompts for the value and stores
it encrypted rather than reading it from the file:

| Variable | Notes |
| --- | --- |
| `SUPABASE_URL` | |
| `SUPABASE_ANON_KEY` | |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS. Rotate immediately if it leaks. |
| `ANTHROPIC_API_KEY` | **Leave blank.** Extraction falls back to the keyword scan |
| `CORS_ORIGINS` | **Leave blank for now** — it is the Vercel URL, which does not exist yet. Set it in §4 |

Blank is safe for the last two. Render submits an untouched field as an empty
string rather than omitting it, and `config.ts` treats blank and absent
identically, so a blank falls through to the documented default. It did not
always: an empty `ANTHROPIC_API_KEY` once failed validation and killed the
process before it listened, and Render reported nothing more specific than a
failed health check.

Verify with `https://<your-app>.onrender.com/health` → `{"status":"ok"}`.

The free plan sleeps after inactivity, so the first request after a quiet period
takes 30–50 seconds. Fine for a demo; not fine for a real response.

---

## 3. Web app on Vercel

Import the repository and set these. Only the first is not inferred from
`frontend/vercel.json`:

| Setting | Value |
| --- | --- |
| **Root Directory** | **`frontend`** |
| Framework Preset | Vite |
| Build Command | `npm run build` |
| Output Directory | `dist` |

**Root Directory is the one that matters.** Left at `./`, Vercel scans the whole
repository, finds the Express app in `backend/` and offers to deploy it as a
second *service* — which is not what this project wants. Setting it to
`frontend` scopes the project to the web app, and the backend is never
considered.

### Environment variables

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | same project as the API |
| `VITE_SUPABASE_ANON_KEY` | public by design; it ships in the bundle |
| `VITE_API_BASE_URL` | `https://<your-app>.onrender.com/api` — **including `/api`** |

Only `VITE_`-prefixed variables reach the bundle, and everything there is public
by design. The service role key belongs in the Render environment, never here —
a `VITE_` prefix on it would inline it into JavaScript every visitor downloads
and void every RLS policy in the project.

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
proxy that forwards `/api` is legitimate — that is what `npm run dev` does. On
Vercel it is not: the SPA rewrite in `frontend/vercel.json` deliberately
excludes `api/`, so an unset value produces a clean 404 on every data call
rather than an HTML page arriving where JSON was expected.

---

## 4. The ordering problem

Each side needs the other's URL, so one pass cannot set both.

1. **Deploy the API to Render.** Put anything in `CORS_ORIGINS` for now.
2. **Deploy the web app to Vercel**, with `VITE_API_BASE_URL` pointing at the
   Render URL from step 1. Note the domain Vercel assigns.
3. **Go back to Render**, set `CORS_ORIGINS` to that domain, and redeploy.

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

## 6. Checklist

- [ ] All seven migration steps applied, in order
- [ ] Render deployed first, `/health` returns `{"status":"ok"}`
- [ ] Vercel **Root Directory set to `frontend`** — not `./`
- [ ] Vercel is **not** treating `backend/` as a second service
- [ ] `VITE_API_BASE_URL` points at the Render API, including `/api`
- [ ] `CORS_ORIGINS` set to the Vercel production domain, and Render redeployed
      **after** setting it
- [ ] Frontend and backend name the **same** Supabase project — compare the
      project refs character by character. A hand-typed ref that differed by one
      character produced confusing failures for an afternoon; `npm run health`
      now checks this explicitly.
- [ ] Service role key set on Render only, never in a `VITE_` variable
- [ ] At least one account promoted to `coordinator`
- [ ] A real report submitted through the deployed UI reaches the board

---

## 7. Why not deploy the backend to Vercel?

It was tried and reverted. This section exists so it is not tried again by
accident.

A root `vercel.json` declaring a `services` block put the API on the same origin
at `/api`, which removed the CORS step and the API base URL entirely. It failed
at deploy time: the `api` service declared `entrypoint: "dist/server.js"`, and
`dist/` is a build artefact — gitignored, and therefore absent from the
repository Vercel checks out. The entrypoint is resolved against the repository,
not against the output of the service's own build command.

Two things would have to change to make it work — committing build output, or
finding an entrypoint form that defers resolution until after the build — and
neither is worth doing, because the architectural objection stands regardless:

- **Rate limiting breaks quietly.** `express-rate-limit` holds its buckets in
  memory. On one long-lived Render instance the documented ceilings are real;
  across serverless instances each gets its own, and the intake limit that
  exists to stop an account looping on a paid Anthropic endpoint stops meaning
  what it says.
- **The code assumes a server.** `server.ts` listens, and `config.ts` validates
  the environment once at boot and throws loudly if it is wrong. Under
  serverless that becomes a 500 on a cold start, visible only in a function log.

Render runs the app the way it was written. The only thing lost is same-origin
convenience, and that costs exactly two settings — §4.
