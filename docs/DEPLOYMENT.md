# TRIPTI — Deployment

Three pieces, deployed separately.

| Piece | Platform | Config |
| --- | --- | --- |
| Database + Auth | Supabase | `supabase/migrations/` |
| API | Render | `render.yaml` |
| Web app | Vercel | `frontend/vercel.json` |

The API and the web app are split deliberately. The API holds the service role
key, which bypasses every RLS policy in the project and must never be built into
anything a browser downloads. Keeping them on separate platforms makes that
boundary a deployment fact rather than a convention someone has to remember.

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

`render.yaml` is a blueprint — point Render at the repository and it reads it.

Every secret is marked `sync: false`, meaning Render prompts for the value and
stores it encrypted rather than reading it from the file. Set:

| Variable | Notes |
| --- | --- |
| `SUPABASE_URL` | |
| `SUPABASE_ANON_KEY` | |
| `SUPABASE_SERVICE_ROLE_KEY` | Bypasses RLS. Rotate immediately if it leaks. |
| `ANTHROPIC_API_KEY` | Optional — omit and extraction uses the fallback |
| `CORS_ORIGINS` | **Must** list the deployed Vercel origin |

`CORS_ORIGINS` is the one that will bite. Left at the dev default the browser
app cannot call the API at all, and the failure looks like a network error
rather than a configuration one.

Health check is `/health`, which deliberately reports nothing about the
deployment — it is unauthenticated and reachable from anywhere.

The free plan sleeps after inactivity, so the first request after a quiet
period takes 30–50 seconds. Fine for a demo; not fine for a real response.

---

## 3. Web app on Vercel

Root directory `frontend`. Set both:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_API_BASE_URL      # https://tripti-api.onrender.com/api
```

Only `VITE_`-prefixed variables reach the bundle, and everything there is public
by design. The service role key belongs in the Render environment, never here.

### The build guard, and why it exists

`frontend/vite.config.ts` fails the build when `VITE_SUPABASE_*` is missing **or
still a placeholder**. Do not remove it.

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

## 5. Checklist

- [ ] All seven migration steps applied, in order
- [ ] `CORS_ORIGINS` includes the Vercel origin
- [ ] `VITE_API_BASE_URL` points at the Render API, including `/api`
- [ ] Frontend and backend name the **same** Supabase project — compare the
      project refs character by character. A hand-typed ref that differed by one
      character produced confusing failures for an afternoon; `npm run health`
      now checks this explicitly.
- [ ] Service role key set on Render only, never in a `VITE_` variable
- [ ] At least one account promoted to `coordinator`
- [ ] `/health` returns `{"status":"ok"}`
- [ ] A real report submitted through the deployed UI reaches the board
