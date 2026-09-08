# TRIPTI — Architecture

Status: **Phase 1 complete**. This document describes both what exists today and
the target architecture the remaining phases build toward. Sections marked
`[built]` are working code; `[planned]` is not implemented yet.

---

## 1. What TRIPTI is

A disaster-response coordination platform. A free-text report — from a citizen,
an NGO, or an operator, in any language — becomes a structured incident, is
scored for priority, is matched against a pool of donated and stockpiled
resources, and is dispatched as a mission with an assigned volunteer, vehicle,
and route. Delivery is verified and folded into impact metrics.

The single sentence that governs every design decision below:

> **The model reads. The engine decides. The human approves.**

An LLM converts unstructured language into structured proposals. Deterministic,
unit-tested functions decide who gets which truck. A human coordinator approves
before anything moves in the real world.

---

## 2. System context

```
┌──────────────┐   report (text / voice / form)
│   Reporter   │──────────────────────────────────┐
│ citizen, NGO │                                  │
└──────────────┘                                  ▼
                                        ┌────────────────────┐
┌──────────────┐   triage, approve      │                    │
│ Coordinator  │◄──────────────────────►│   TRIPTI backend   │
└──────────────┘                        │  Express + Node    │
                                        │                    │
┌──────────────┐   accept, status       │                    │
│  Volunteer   │◄──────────────────────►│                    │
└──────────────┘                        └───┬───────┬────┬───┘
                                            │       │    │
┌──────────────┐   list surplus             │       │    │
│  Food donor  │◄───────────────────────────┘       │    │
└──────────────┘                                    │    │
                                   ┌────────────────┘    └──────────────┐
                                   ▼                                    ▼
                        ┌──────────────────┐                 ┌────────────────────┐
                        │ Supabase         │                 │ Anthropic API      │
                        │ Postgres + RLS   │                 │ extraction only    │
                        │ Auth + Realtime  │                 └────────────────────┘
                        └──────────────────┘                 ┌────────────────────┐
                                                             │ Geocode / routing  │
                                                             │ (provider adapter) │
                                                             └────────────────────┘
```

---

## 3. Runtime topology

| Process              | Runs on             | Holds                                    |
| -------------------- | ------------------- | ---------------------------------------- |
| `frontend` (SPA)     | Vercel / static CDN | Supabase **anon** key only                |
| `backend` (REST API) | Render / Railway    | Supabase **service role** key, Anthropic key |
| Postgres + Auth      | Supabase            | All persistent state                      |

The browser never talks to the Anthropic API and never holds a privileged key.
It reads through RLS-protected tables (for realtime) and writes through the
backend (for anything privileged).

---

## 4. Trust model — two clients, two levels

This is the most important invariant in the codebase.

```
Browser ──anon key──► Supabase        every table needs an RLS policy
Backend ──service key─► Supabase      bypasses RLS entirely
```

`backend/src/supabase.ts` exports two clients:

- `admin` — service role. **Bypasses RLS.** Every route that touches it must run
  `requireAuth` and, where privileged, `requireRole` *first*. There is no safety
  net underneath it.
- `verifier` — anon key, used solely to validate an incoming bearer token.

**Roles come from the database, not the token.** `requireAuth` verifies the JWT
with Supabase, then reads `role` from `profiles`. A revoked role takes effect
immediately rather than at token expiry, and a caller cannot claim a role by
editing a header or a JWT claim.

Adding a table means adding its RLS policies **in the same migration**.

---

## 5. Backend

### 5.1 Current layout `[built]`

```
backend/src
  config.ts            zod-validated env, throws at boot on anything missing
  supabase.ts          admin client + token verifier
  middleware/auth.ts   requireAuth / requireRole, ROLES
  middleware/rateLimit.ts  general + AI-route buckets
  lib/
    errors.ts          AppError — deliberate, client-safe failures
    history.ts         the only writer to the append-only audit trail
  ai/
    client.ts          Anthropic client + single MODEL constant
    extractIncident.ts free text -> structured incident proposal
  engine/
    priority.ts        deterministic priority score (pure)
    match.ts           greedy need->resource matcher (pure)
    match.test.ts      13 tests
  routes/
    incidents.ts       GET /, POST /, GET /:id, PATCH /:id
    profile.ts         GET /, PATCH /, GET /all, PATCH /:id/role
    match.ts           POST /preview
  app.ts               helmet, CORS, limits, mounts, /health, error handler
  server.ts            listen
```

### 5.2 Target layering `[planned]`

The PRD asks for route → controller → service → repository. The current code is
route → (inline handler) → engine/db, which is fine at four endpoints and will
not be fine at thirty. The migration is incremental, not a rewrite:

```
routes/        HTTP shape only: zod parse, status codes, no business logic
  ↓
services/      business rules, orchestration, transactions
  ↓
repositories/  the only place `admin.from(...)` appears
  ↓
Supabase
```

Cross-cutting:

```
middleware/    auth, rate limiting, request id, error handler
schemas/       zod schemas shared between routes and services
engine/        pure decision functions — no I/O, no db, no network, ever
ai/            provider-isolated; every export returns validated, typed data
integrations/  geocoding + routing behind an interface, provider swappable
lib/           logger, errors (AppError with status + safe message)
```

**Rule:** nothing in `engine/` may import from `ai/`, `routes/`, or `supabase.ts`.
That isolation is what makes allocation explainable and testable.

### 5.3 Error handling `[built]`

Handlers call `next(err)`. `app.ts` distinguishes two cases:

- **`AppError`** (`lib/errors.ts`) — a deliberate failure whose message was
  written for a user to read. Passed through with its status.
- **Anything else** — a bug. Detail goes to the log, the caller gets
  `{ error: 'Internal server error' }`.

Validation failures return `400` with a generic message; zod errors are never
echoed to the client, because they describe internal field names and shapes.

---

## 6. The decision engine

Pure functions. No I/O. Same input, same output, forever.

### 6.1 Priority `[built]`

`engine/priority.ts` scores a need from stated facts:

| Term                          | Contribution                         |
| ----------------------------- | ------------------------------------ |
| Severity (low→critical)       | 10 / 30 / 60 / 100                   |
| People affected               | up to +40, logarithmic (sublinear)   |
| Age (minutes waiting)         | up to +30, so nothing starves        |
| Life-critical kind            | +50 (rescue, medical, evacuation)    |
| Unmet                         | +10                                  |

The age cap is deliberate: an old low-severity report can never outrank a fresh
critical one. There is a test asserting exactly that.

The PRD states weights as percentages (30/25/20/15/10). The additive form above
is the same ordering expressed in points, and it is what the tests pin. Phase 3
will expose the weights as a configuration object and surface a per-term
breakdown to the coordinator, so the score is explainable in the UI rather than
just auditable in the source.

### 6.2 Matching `[built]`

`engine/match.ts` — highest-priority need first, nearest capable resource wins.
Resource quantities are decremented as matches are made, so a single truck is
never promised to two places. Partial fulfilment across multiple resources is
supported. `null` quantity means unmetered (a rescue team, a doctor).

Distance is great-circle (`haversineKm`) — good enough for ranking. Real ETAs
come from the routing provider in Phase 5.

`[planned]` The PRD's fuller match score adds quantity fit, time fit (expiry!),
and transport fit. Those become additional terms, still deterministic, still
tested.

### 6.3 Coordinates are never invented

Extraction copies the place name into `location_text` and leaves `lat`/`lon`
null. Geocoding is a separate, explicit step. Needs without coordinates are
**excluded** from the match plan and returned in `needsMissingCoordinates` for
manual handling — never silently dropped.

---

## 7. AI layer

```
route ──► ai/extractIncident.ts ──► ai/client.ts ──► Anthropic
                   │
                   └─► zod schema validates the structured output
```

- The model **extracts, classifies, summarizes, translates**. It does not rank,
  assign, or allocate.
- Output is a *proposal*. It lands on the incident beside `ai_confidence` and
  `ai_unclear`, with `status = 'open'`. A human triages before dispatch. Nothing
  auto-advances past `open` on the strength of a model response.
- The model id lives in exactly one place: `ai/client.ts`. Never inline a model
  string at a call site.
- Structured output is validated by zod at the boundary. A refusal or an
  unparseable response throws rather than producing a half-populated incident.

`[planned]` A provider adapter interface (`AiProvider`) so the app is not welded
to one vendor, plus a deterministic fallback path: if extraction fails, the
incident is still created from the raw text with `severity = 'medium'`,
`ai_confidence = null`, and a flag telling the coordinator to classify manually.
**An AI outage must degrade intake, not block it.**

---

## 8. Data model

Built today (`supabase/migrations/0001_init.sql`):

```
auth.users ──1:1──► profiles (role)
                       │
incidents ──1:N──► needs ──1:N──► missions ──N:1──► resources
    │                                  │
    └──────────► status_history ◄──────┘   (append-only, all entity types)
```

Planned additions (Phase 2), each with RLS policies in the same migration:

```
volunteers          skills, availability, current location, workload
vehicles            type, capacity, availability, location
food_listings       surplus food with expiry_time  ── the time-sensitive supply
mission_stops       multi-stop pickup/delivery ordering
routes              geometry, distance, duration, optimization score
impact_metrics      people helped, meals saved, waste prevented, response time
notifications       operator + volunteer alerts
reallocation_events before/after plan, rationale, approver  (Phase 7 audit)
```

`status_history` is **append-only**. Never updated, never deleted. A
post-incident review has to be able to reconstruct what was known when, and a
mutable audit table cannot do that.

---

## 9. Frontend

### 9.1 Current `[built]`

React 19 + Vite + Tailwind v4 + React Router.

- `components/ui/` — Button, Card, Badge (+ Severity/Status), Field (Input,
  Textarea, Select), Alert, Spinner, Skeleton, EmptyState, ErrorState,
  ConfirmDialog, Toast provider.
- `features/auth/` — `AuthProvider` (session + authoritative profile),
  `ProtectedRoute`, `RoleRoute`, sign-in, registration with role selection,
  profile editing.
- `layouts/` — `AppShell` (responsive nav, role badge, sign-out) and
  `AuthLayout`.
- `pages/` — landing, dashboard (live counts), incidents (live list). Resources
  and missions are honest empty states, not mocked data.
- `hooks/useAsync.ts` — the loading / empty / error / retry contract in one place.

### 9.2 Target `[planned]`

```
src/
  components/   design system: Button, Card, Badge, Table, Dialog, Toast,
                Skeleton, EmptyState, ErrorState, Field
  features/     auth, incidents, resources, matching, food-rescue, missions,
                maps, reallocation, analytics   (each: components + hooks + api)
  layouts/      AppShell (nav + header), AuthLayout, PublicLayout
  pages/        thin route components composing features
  hooks/        useAuth, useRealtime, useToast
  lib/          api client, supabase client, formatters
  routes/       route table + ProtectedRoute / RoleRoute
  types/        shared API types
```

Rules: business logic never lives in a component; data access never lives
inline in a page; every async surface has loading / empty / error / success
states.

### 9.3 Theming

Tailwind v4 — tokens live in `@theme` in `src/index.css`. There is no
`tailwind.config.js`. Severity colors are `--color-sev-{low,medium,high,critical}`;
use those rather than hardcoding a red, so severity reads identically on a map
marker, a badge, and a chart.

---

## 10. Realtime

Supabase Realtime publishes `incidents`, `needs`, `missions`. The dashboard and
the mission board subscribe directly from the browser — reads are RLS-gated, so
this is safe with the anon key. Writes always go through the backend.

`[planned]` `useRealtime` hook; optimistic-free invalidation (subscribe → refetch)
rather than trusting the payload, so the browser never renders a row it would not
have been allowed to read.

---

## 11. Maps and routing `[planned]`

Both behind an interface in `integrations/`:

```ts
interface GeocodingProvider { geocode(query: string): Promise<Coords | null> }
interface RoutingProvider {
  route(stops: Coords[]): Promise<{ distanceKm: number; durationMin: number; geometry: unknown }>
}
```

MVP implementations: OSM Nominatim for geocoding, OSRM for routing, with a
haversine + average-speed fallback that always works offline. Leaflet renders.
No provider-specific types leak past the adapter.

---

## 12. Mission lifecycle `[planned]`

```
proposed ──► accepted ──► en_route ──► delivered ──► (verified) ──► completed
    │            │            │
    └────────────┴────────────┴──► cancelled / failed
```

The DB enum currently holds `proposed | accepted | en_route | delivered | failed
| cancelled`; Phase 6 adds `verified`/`completed` and a transition table. Illegal
transitions are rejected by a pure function in `engine/`, and **every** accepted
transition writes a `status_history` row.

---

## 13. Dynamic reallocation `[planned, Phase 7]`

The headline feature. When a new critical incident arrives:

1. Recompute priorities across all open needs.
2. Partition committed resources into *releasable* (mission still `proposed`)
   and *protected* (`accepted` or later, or itself life-critical).
3. Re-run the matcher over available + releasable supply.
4. Produce a **before/after diff** with a per-move rationale.
5. Require explicit coordinator approval.
6. Execute, and write the whole thing to the audit trail.

A committed, in-progress, life-critical mission is never disrupted automatically.

---

## 14. Security posture

| Control                | State                                            |
| ---------------------- | ------------------------------------------------ |
| Auth                   | Supabase Auth, JWT bearer `[built, backend only]` |
| Role source            | `profiles` table, never the token `[built]`       |
| RLS                    | Enabled on every table `[built]`; recursion bug fixed in 0003 |
| Input validation       | zod at every route boundary `[built]`             |
| Error leakage          | Generic messages, detail to logs `[built]`        |
| Secrets                | `.env`, gitignored, `.env.example` committed `[built]` |
| CORS                   | Explicit origin allowlist `[built]`               |
| Rate limiting          | 120/min general, 10/min on AI intake `[built]`    |
| Secure headers         | helmet `[built]`                                  |
| Audit log              | `lib/history.ts` writes on incident create + triage `[built]`; missions pending |
| PII exposure           | Moved to `incident_contacts`, backend-only, no RLS policy `[built]` |

---

## 15. Deployment

| Piece    | Target             | Notes                                            |
| -------- | ------------------ | ------------------------------------------------ |
| Frontend | Vercel             | Set `VITE_API_BASE_URL` to the deployed API       |
| Backend  | Render / Railway   | Set `CORS_ORIGINS` to the deployed frontend origin |
| Database | Supabase           | Run migrations in order via SQL editor or CLI     |

Health check: `GET /health` returns `{"status":"ok"}` for platform probes, with
the same handler mounted at `/api/health` for the frontend's dev proxy `[built]`.

CI runs install → lint → test → typecheck+build on every push and PR
(`.github/workflows/ci.yml`) `[built]`.

---

## 16. Decisions on record

| # | Decision | Why |
| - | -------- | --- |
| 1 | LLM never allocates | Allocation must be explainable and reproducible after the fact |
| 2 | Two Supabase clients | Least privilege; the browser physically cannot hold the service key |
| 3 | Role from DB, not JWT | Instant revocation; no client-asserted authority |
| 4 | Plain lat/lon, not PostGIS | Haversine ranking is enough at this scale; migrate when radius queries get heavy |
| 5 | Append-only history | Post-incident review needs an immutable record |
| 6 | Greedy matcher for MVP | Deterministic and explainable now; OR-Tools when multi-stop capacity matters |
| 7 | Provider adapters for AI/maps | No vendor welded into the domain |
| 8 | Coordinates never inferred | A wrong coordinate in a disaster sends a truck to the wrong place |
