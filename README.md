# TRIPTI

Disaster-response coordination platform. Free-text incident reports are extracted
into structured needs by an LLM, then matched against available resources by a
deterministic engine and dispatched as missions.

## Stack

| Layer     | Choice                                              |
| --------- | --------------------------------------------------- |
| Frontend  | React 19, Vite, Tailwind v4, React Router, Leaflet, Recharts |
| Backend   | Node 24, Express 5, TypeScript, zod                 |
| Database  | Supabase Postgres (RLS) + Supabase Auth + Realtime  |
| AI        | Claude (`@anthropic-ai/sdk`) for extraction and classification |
| Tests     | Vitest                                              |

## Getting started

```bash
npm run install:all
```

Then create a Supabase project and run the migrations in `supabase/migrations/`
in filename order. Run `0002_roles.sql` on its own and let it commit before
`0003_auth_and_integrity.sql` — Postgres will not let a newly added enum value be
used in the transaction that added it.

Fill in the env files:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

`backend/.env` needs the Supabase URL, anon key, **service role key**, and an
Anthropic API key. `frontend/.env.local` needs the URL and anon key only.

```bash
npm run dev
```

API on http://localhost:4000, web on http://localhost:5173 (proxying `/api` to
the API, so there's no CORS in dev).

## Roles

Six roles, from the PRD. Four are self-service at signup; `coordinator` (the
PRD's "Emergency Operator") and `admin` are granted by an existing admin through
`PATCH /api/profile/:id/role`. The clamp is enforced in the signup form, in the
`handle_new_user()` database trigger, and again by a trigger that rejects any
role change made with a user's own token.

| Role | Can |
| ---- | --- |
| `citizen` | Report emergencies, follow their own reports |
| `volunteer` | Accept missions, update status from the field |
| `donor` | List surplus food and supplies with a deadline |
| `ngo` | Publish shelter capacity and resources |
| `coordinator` | Triage, approve allocations, run missions |
| `admin` | Everything, plus role grants |

## Scripts

| Command             | Does                                        |
| ------------------- | ------------------------------------------- |
| `npm run dev`       | Both servers with prefixed output           |
| `npm run test`      | Backend unit tests (matching engine)        |
| `npm run typecheck` | Backend `tsc --noEmit` + frontend `tsc -b`  |
| `npm run build`     | Production build of both                    |
| `npm run lint`      | Frontend oxlint                             |

CI (`.github/workflows/ci.yml`) runs install → lint → test → typecheck + build on
every push and pull request.

## Architecture

```
free-text report
      │
      ▼
POST /api/incidents ──► Claude extraction ──► incident + needs (status: open)
                                                    │
                                          coordinator triages
                                                    │
                                                    ▼
                                   POST /api/match/preview
                                   deterministic priority + greedy nearest match
                                                    │
                                          coordinator approves
                                                    │
                                                    ▼
                                        missions (+ routes, realtime status)
```

The LLM extracts and classifies; it never decides allocation. Scoring and
matching are pure functions in `backend/src/engine/`, unit-tested and
explainable. See [CLAUDE.md](CLAUDE.md) for the full set of constraints.

## Deployment

Frontend to Vercel, backend to Render or Railway, database on Supabase. Set
`CORS_ORIGINS` on the backend to the deployed frontend origin, and
`VITE_API_BASE_URL` on the frontend to the deployed API before shipping.
