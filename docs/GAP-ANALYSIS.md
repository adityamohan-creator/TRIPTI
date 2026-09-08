# TRIPTI — PRD gap analysis (Phase 0)

Audited: 2026-09-08. Repository state: 46 tracked-able files, **zero commits**,
both workspaces installed, all checks green.

## Verified baseline

| Check                       | Result                                  |
| --------------------------- | --------------------------------------- |
| `npm --prefix backend test` | ✅ 13 tests passing (1 file, 247ms)      |
| `npm run typecheck`         | ✅ backend clean, frontend `tsc -b` clean |
| `npm --prefix frontend build` | ✅ 232 kB / 74 kB gzip                 |
| `npm run lint`              | ✅ oxlint clean                          |
| Node / npm                  | 24.19.0 / 11.17.0                        |
| `.env` files present        | ❌ neither exists — nothing can run yet   |
| Git history                 | ❌ no commits                             |

**Honest summary:** the skeleton is unusually good — the trust model, the pure
engine, the migration, and the CLAUDE.md constraints are production-grade
thinking. But it is a skeleton. There is **no authentication in the browser at
all**, all four pages are placeholders, and of the PRD's 15 major features
roughly 2.5 exist. Nothing is deployable and nothing is demo-able today.

---

## 1. Feature-level gap table

Priority: **P0** = demo fails without it · **P1** = demo is weak without it ·
**P2** = nice to have.

| # | PRD requirement | Existing status | Missing | Plan | Pri |
|---|---|---|---|---|---|
| 1 | AI Crisis Analyzer | ✅ `ai/extractIncident.ts`, zod-validated, good system prompt | Provider adapter; fallback when API fails; prompt-injection guard; voice/multilingual entry point | Phase 3: wrap in `AiProvider`, add deterministic degrade path | P0 |
| 2 | AI Priority Engine | ✅ `engine/priority.ts` + tests | Configurable weights; per-term explanation payload for the UI; vulnerability + shortage terms from the PRD formula | Phase 3: return `{score, level, breakdown[]}` | P0 |
| 3 | Response Plan Generator | ⚠️ `POST /api/match/preview` returns raw matches | Coverage %, shortage list, volunteer/vehicle needs, ETA, persisted plan for approval | Phase 4: `response_plans` table + service | P0 |
| 4 | Smart Resource Matching | ✅ `engine/match.ts` greedy + tests | Quantity-fit / time-fit / transport-fit terms; reservation to prevent over-allocation across concurrent requests | Phase 4: extend score, add DB-level reservation | P0 |
| 5 | Food waste → need matching | ❌ nothing | `food_listings` with `expiry_time`; expiry boost in the matcher; donor UI | Phase 4 | P1 |
| 6 | Volunteer assignment | ❌ nothing | `volunteers` table, skills/availability/workload, assignment function | Phase 5 | P0 |
| 7 | Vehicle assignment | ❌ nothing | `vehicles` table, capacity fit | Phase 5 | P1 |
| 8 | Route optimization | ❌ nothing | Routing provider adapter, `routes` + `mission_stops`, multi-stop ordering | Phase 5 | P0 |
| 9 | Live crisis map | ❌ Leaflet installed, never imported | Map component, markers by severity token, clustering, popups | Phase 5 | P0 |
| 10 | Mission tracking | ⚠️ `missions` table + enum only | No create/list/transition routes; no state machine; no timeline UI | Phase 6 | P0 |
| 11 | Realtime | ⚠️ publication configured in SQL | No browser subscription, no `useRealtime` | Phase 6 | P0 |
| 12 | Dynamic reallocation | ❌ nothing | Releasable/protected partition, before-after diff, approval, audit | Phase 7 | P0 |
| 13 | Shortage forecasting | ❌ nothing | Demand rollup + naive projection | Phase 8 | P2 |
| 14 | What-if simulator | ❌ nothing | Scenario input → matcher on a hypothetical pool | Phase 8 | P2 |
| 15 | Trust / fraud detection | ❌ nothing | Duplicate + implausible-quantity heuristics | Phase 8 | P2 |
| 16 | Voice + multilingual intake | ⚠️ `source_language` extracted | Web Speech API capture; language surfaced in UI | Phase 8 | P2 |
| 17 | Impact analytics | ❌ Recharts installed, never imported | `impact_metrics`, aggregation endpoint, dashboard charts | Phase 8 | P1 |
| 18 | Auth + roles | ⚠️ **backend only** | No login/register/logout UI, no session, no protected routes, no role routing, no profile page | Phase 1 | P0 |
| 19 | Resource CRUD | ❌ table exists, no routes, no UI | Full CRUD + donor/NGO screens | Phase 2 | P0 |
| 20 | Needs CRUD | ⚠️ inserted by extraction only | List/update/fulfil endpoints | Phase 2 | P0 |
| 21 | Demo seed / reset | ❌ nothing | `scripts/seed-demo-data`, `reset-demo-data`, `health-check` | Phase 8 | P0 |
| 22 | Docs suite | ⚠️ README + CLAUDE.md + this audit | API, DATABASE, AI, SECURITY, DEPLOYMENT, TESTING, DEMO | rolling | P1 |
| 23 | CI | ❌ nothing | GitHub Actions: install → lint → typecheck → test → build | Phase 1 | P1 |

---

## 2. Defects found in existing code

These are bugs in code that already exists, not missing features. Fix before
building on top.

### D1 — RLS infinite recursion on `profiles` UPDATE · **P0** · `supabase/migrations/0001_init.sql`

```sql
create policy "own profile is updatable" on profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id and role = (select role from profiles where id = auth.uid()));
```

The `WITH CHECK` clause subqueries `profiles` from inside a policy **on**
`profiles`. Postgres raises `infinite recursion detected in policy for relation
"profiles"`. Any browser-side profile update fails outright.

The intent — "a user may edit their profile but not escalate their own role" —
is correct and worth keeping. Fix with a `SECURITY DEFINER` helper that reads the
role outside RLS, or a `BEFORE UPDATE` trigger that pins `NEW.role = OLD.role`
unless the caller is an admin. Trigger is the cleaner option.

### D2 — Health endpoint shape and path · **P0** · `backend/src/app.ts`

PRD §25 requires `GET /health` → `{"status":"ok"}`. The code serves
`GET /api/health` → `{ ok: true, env: ... }`. Render/Railway probes and the
acceptance checklist both expect the documented form. Add `/health` with the
correct shape (keep `/api/health` for the SPA), and stop leaking `NODE_ENV` to
unauthenticated callers.

### D3 — `updated_at` never updates · **P0** · migration

`incidents.updated_at` and `missions.updated_at` default to `now()` and are never
touched again. Any "last changed" display or ordering will be wrong. Add a shared
`set_updated_at()` trigger function and attach it to both tables.

### D4 — `status_history` is written by nobody · **P0** · backend

The table, its index, and its RLS policy exist. Not one line of code inserts into
it. The append-only audit trail that CLAUDE.md calls a hard rule is currently
empty by construction. Every status transition — incident triage, need
fulfilment, mission progress — must write a row, ideally in the same transaction
as the change.

### D5 — Frontend crashes on missing env · **P1** · `frontend/src/lib/supabase.ts`

The module throws at import scope, which takes down the entire bundle with a
blank white page and a console error. For a judge or a new contributor with an
unconfigured `.env.local`, this reads as "the app is broken". Render a
configuration-error screen instead of throwing.

### D6 — `PATCH /incidents/:id` skips history and coordinate validation · **P1** · `routes/incidents.ts`

Triage writes `triaged_by` but records no history row (see D4), and accepts a
`lat` without a `lon` (or vice versa), producing a half-located incident that the
matcher will silently exclude. Require the pair together.

### D7 — `POST /match/preview` ignores existing commitments · **P1** · `routes/match.ts`

It selects resources with `status = 'available'` but does not subtract quantities
already committed to `proposed`/`accepted` missions. Once mission creation exists,
the same units can be promised twice across two consecutive previews. Needs a
reservation model, not just a status flag.

### D8 — No rate limiting on AI-backed intake · **P1** · `backend/src/app.ts`

`POST /api/incidents` calls the Anthropic API on every request with no throttle.
Any authenticated account can burn the API budget. Add `express-rate-limit`, with
a tighter bucket on AI routes.

### D9 — Missing security headers · **P2** · `backend/src/app.ts`

No `helmet`. Add it.

### D10 — Reporter PII readable by every authenticated user · **P1** · migration

`incidents` RLS is `for select using (auth.uid() is not null)` and the table
includes `reporter_phone`. Any signed-in account — including a `viewer` — can
read every reporter's phone number. PRD §18 explicitly says not to expose citizen
contact details unnecessarily. Restrict the column to coordinator/admin, via a
view or column-level grants.

### D11 — Cosmetic · **P2**

`frontend/index.html` still has `<title>frontend</title>`. `frontend/README.md` is
the stock Vite template.

---

## 3. Architectural debt (acceptable now, plan for it)

| Item | Assessment |
|---|---|
| No controller/service/repository split | Fine at 4 endpoints. Introduce the layer in Phase 2 while adding resource/need CRUD, before it becomes a rewrite. |
| No generated Supabase types | `oneRelation` in `routes/match.ts` is an honest workaround for an untyped relation. Generate `database.types.ts` in Phase 2 and delete the workaround. |
| No shared types between backend and frontend | Duplication is coming. A small `shared/` package or hand-mirrored `frontend/src/types/api.ts` in Phase 2. |
| No structured logging | `console.error` only. Swap for a request-id-carrying logger in Phase 8. |
| No pagination | `GET /incidents` caps at 200 rows with no cursor. Fine for the demo, wrong for production. |
| Priority weights hardcoded | PRD says configurable. Extract to a config object in Phase 3. |
| Root and `frontend/` both hold a `package-lock.json`, plus `backend/` | Three lockfiles for three separate npm projects — intentional, not a bug. |

---

## 4. Non-functional requirements

| Requirement | Status |
|---|---|
| Responsive / accessible UI | ❌ nothing built beyond a nav bar |
| Loading / empty / error states | ❌ no async UI exists |
| Role-based access control | ⚠️ backend enforced, frontend absent |
| Input validation | ✅ zod on all four endpoints |
| Secrets management | ✅ gitignored, `.env.example` committed |
| Audit trail | ❌ table exists, unused (D4) |
| Rate limiting | ❌ (D8) |
| Error opacity to clients | ✅ generic messages, detail logged |
| Health check | ⚠️ wrong path and shape (D2) |
| CI | ❌ |
| Deployment config | ❌ no `vercel.json`, no `render.yaml`, no Dockerfile |
| Demo repeatability | ❌ no seed or reset script |

---

## 5. Sequenced plan

Ordering is driven by dependency, not by the PRD's section order. Auth blocks
every UI surface, so it goes first; the reallocation showcase depends on missions,
which depend on matching, which depends on resources.

| Phase | Scope | Unblocks |
|---|---|---|
| **1** | Fix D1, D2, D3, D5. Design system + AppShell. Supabase auth: register / login / logout / session / protected + role routes / profile. CI workflow. | every screen |
| **2** | Generated DB types. Migration `0002`: volunteers, vehicles, food_listings, mission_stops, routes, impact_metrics, notifications + RLS. Service/repository layer. Resource + need CRUD with UI. Fix D6, D10. `status_history` writer (D4). | matching, food rescue |
| **3** | AI provider adapter + fallback. Priority breakdown payload. Incident intake UI with AI review screen, confidence and `unclear` surfaced, human override. | operator triage |
| **4** | Extended match score (quantity/time/transport). Reservations, fixing D7. Response plan persistence + approval. Food rescue with expiry boost. | missions |
| **5** | Geocoding + routing adapters. Leaflet map. Volunteer and vehicle assignment. | dispatch |
| **6** | Mission state machine, transition endpoints, realtime subscriptions, mission timeline UI, delivery verification. | reallocation |
| **7** | Dynamic reallocation: releasable/protected partition, before/after diff, rationale, approval, audit. | the demo's climax |
| **8** | Impact analytics + charts. Rate limiting, helmet (D8, D9). Seed / reset / health-check scripts. Full docs suite. Deployment. What-if simulator and voice intake if time remains. | ship |

Day mapping per the master prompt: Day 1 → Phase 0+1 · Day 2 → Phase 2 ·
Day 3 → Phases 3+4 · Day 4 → Phases 5+6+7 · Day 5 → Phase 8.

---

## 6. Open questions for the product owner

CLAUDE.md's "Domain" section is explicitly unfilled, and these change real
implementation choices. Working assumptions are stated so nothing blocks — flag
any that are wrong.

| Question | Working assumption |
|---|---|
| Region and coordinate defaults | India; map centres on Delhi NCR; distances in km |
| Intake languages | Hindi + English, any other input translated to English on extraction |
| Unit of "impact" | People helped, meals delivered, litres of water, kg of food waste prevented |
| Who may approve a dispatch | `coordinator` and `admin` only |
| Whether citizens see other citizens' reports | No — own reports only; the current permissive RLS (D10) contradicts this |
| Real dispatch vs simulation | Simulated for the hackathon; all demo data labelled as such per PRD §18 |
| Food safety rules | Expiry deadline enforced by the matcher; no cooked food matched past its deadline |
