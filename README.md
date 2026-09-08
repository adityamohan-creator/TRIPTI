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

Then follow **[docs/SETUP.md](docs/SETUP.md)** — migrations, keys, env files and
the first coordinator account, in order. It takes about ten minutes.

```bash
npm run dev     # API on :4000, web on :5173
npm run health  # verifies migrations, roles and RLS actually applied
```

`npm run health` is the one to run after any setup or deploy. It checks the
failures that are silent: a migration whose `ALTER`s did not run, a missing enum
value, or an anon key that can reach reporter phone numbers.

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
| `npm run health`    | Verify Supabase schema, roles and RLS       |
| `npm run db:bundle` | Bundle the migrations into two paste-ready blocks |

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
