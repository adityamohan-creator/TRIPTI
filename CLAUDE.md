# TRIPTI

Disaster-response coordination platform. Incidents come in as free text, get
AI-extracted into structured needs, and are matched against donor/volunteer
resources into dispatchable missions with routes.

> The product brief is still being written. Fill in the "Domain" section below as
> decisions get made — anything not written down here will be guessed at.

## Commands

```bash
npm run install:all   # install both workspaces
npm run dev           # api on :4000 + web on :5173
npm run test          # backend vitest (engine has real coverage; start here)
npm run typecheck     # backend tsc --noEmit, then frontend tsc -b via build
npm run build         # both
```

Single test file: `npm --prefix backend run test -- src/engine/match.test.ts`

## Layout

```
backend/src
  config.ts            zod-validated env; throws at boot on anything missing
  supabase.ts          service-role client (bypasses RLS) + token verifier
  middleware/auth.ts   requireAuth / requireRole
  ai/                  Claude calls — extraction and classification only
  engine/              deterministic priority + matching (pure functions)
  routes/              express routers
frontend/src
  lib/api.ts           fetch wrapper; attaches the Supabase access token
  lib/supabase.ts      browser client, anon key only
  pages/               route components
supabase/migrations/   schema, RLS policies, realtime publication
```

## Rules that matter here

**The LLM never makes allocation decisions.** `ai/` extracts, classifies,
summarizes, and translates. Who gets which truck is decided by pure functions in
`engine/` — deterministic, unit-tested, and explainable to a coordinator after
the fact. If a feature needs the model to rank or assign, that is a design
problem, not an implementation detail: raise it rather than wiring it up.

**AI output is a proposal, not a record.** Extracted fields land on the incident
with `ai_confidence` and `ai_unclear` beside them, status `open`. A human
coordinator triages before anything dispatches. Never auto-advance past `open`
on the strength of a model response.

**Two Supabase clients, two trust levels.** The browser holds only the anon key,
so every table it touches needs an RLS policy in
`supabase/migrations/`. The backend holds the service role key and bypasses RLS
completely — so any route using `admin` must check authorization itself via
`requireAuth`/`requireRole` first. Adding a table means adding its policies in
the same change.

**Roles come from the database, not the token.** `requireAuth` reads `role` from
`profiles`. Never trust a role from a JWT claim or a request header.

**Never invent coordinates.** Extraction copies the place name into
`location_text` and leaves lat/lon null. Geocoding is a separate, explicit step.
Needs without coordinates are excluded from the match plan and returned in
`needsMissingCoordinates` for manual handling — don't silently drop them.

**Append-only history.** `status_history` is never updated or deleted; a
post-incident review has to be able to reconstruct what was known when.

## Conventions

- TypeScript, ESM everywhere. Backend imports carry the `.js` extension
  (`./config.js`) — required by `moduleResolution: nodenext`.
- `strict` plus `noUncheckedIndexedAccess` in the backend; expect `!` or a guard
  after array indexing.
- Validate every request body and query with zod at the route boundary. Return
  `400` with a generic message; never echo the zod error to the client.
- Errors bubble to the handler in `app.ts` via `next(err)`. Detail goes to the
  log, `{ error: 'Internal server error' }` goes to the caller.
- Tailwind v4 — theme tokens live in `@theme` in `frontend/src/index.css`, there
  is no `tailwind.config.js`. Severity colors are `--color-sev-*`; use those
  rather than hardcoding a red.
- Claude model id is centralized in `backend/src/ai/client.ts`. Don't inline
  model strings at call sites.

## Domain

_To fill in: who the users are, which disasters and regions are in scope, what
"impact" is measured in, which languages intake must handle, and what the
operational escalation path looks like._

## Not wired up yet

Geocoding, routing/distance matrix, mission creation from a match preview,
realtime subscriptions on the frontend, and dashboard charts. The pages under
`frontend/src/pages/` are placeholders.
