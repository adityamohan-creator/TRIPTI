# TRIPTI — Development guide

Everything you need to get from a clean clone to a running stack, plus the
conventions that keep the codebase coherent.

---

## 1. Prerequisites

| Tool     | Version verified in this repo |
| -------- | ----------------------------- |
| Node     | 24.19.0                       |
| npm      | 11.17.0                       |
| Supabase | a free project is enough      |

You also need an **Anthropic API key** for incident extraction. Without it the
backend refuses to boot (`config.ts` validates env at startup and throws).

---

## 2. First run

```bash
npm run install:all
```

Installs both workspaces (`backend/` and `frontend/` are separate npm projects;
the root package only orchestrates).

### 2.1 Database

Create a Supabase project, open the SQL editor, and run every file in
`supabase/migrations/` **in filename order**. Currently that is just
`0001_init.sql`.

Then grab three values from Project Settings → API:

- Project URL
- `anon` public key
- `service_role` key — **server only**, it bypasses row level security

### 2.2 Environment

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

| File                    | Needs                                                                   |
| ----------------------- | ----------------------------------------------------------------------- |
| `backend/.env`          | `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` |
| `frontend/.env.local`   | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`                            |

Only `VITE_`-prefixed variables reach the browser bundle. The service role key
must never appear in a `VITE_` variable, a frontend file, or a commit. If it
leaks, rotate it in the Supabase dashboard immediately.

Both `.env` and `.env.local` are gitignored; `.env.example` is committed.

### 2.3 Run

```bash
npm run dev
```

- API → http://localhost:4000
- Web → http://localhost:5173

Vite proxies `/api` to the API in dev, so the browser stays on one origin and
there is no CORS preflight locally.

---

## 3. Commands

| Command                | Does                                                        |
| ---------------------- | ----------------------------------------------------------- |
| `npm run install:all`  | Install both workspaces                                     |
| `npm run dev`          | Both servers, prefixed output                               |
| `npm run test`         | Backend Vitest suite                                        |
| `npm run typecheck`    | Backend `tsc --noEmit`, then frontend `tsc -b` via build     |
| `npm run lint`         | Frontend oxlint                                             |
| `npm run build`        | Production build of both                                    |

Single test file:

```bash
npm --prefix backend run test -- src/engine/match.test.ts
```

Watch mode:

```bash
npm --prefix backend run test:watch
```

---

## 4. Conventions

### TypeScript

- ESM everywhere. **Backend imports carry the `.js` extension** (`./config.js`) —
  required by `moduleResolution: nodenext`. This trips everyone up once.
- Backend runs `strict` plus `noUncheckedIndexedAccess`, `noUnusedLocals`,
  `noUnusedParameters`, `erasableSyntaxOnly`. Expect to write `!` or a guard
  after indexing an array.
- No `any`. If a Supabase relation comes back with an awkward shape, normalize it
  in one narrow helper (see `oneRelation` in `routes/match.ts`) rather than
  spreading casts.

### Routes

- Validate **every** body and query with zod at the route boundary.
- Return `400` with a generic message. Never echo the zod error to the client —
  it describes internal field names.
- Errors bubble via `next(err)`. Detail goes to the log, `{ error: 'Internal
  server error' }` goes to the caller.
- Any route touching the `admin` client runs `requireAuth` first, and
  `requireRole(...)` if the action is privileged.

### The engine

`backend/src/engine/` is pure. No database, no network, no `Date.now()` inside a
scoring function — pass age in as a parameter. If you cannot unit-test it without
a mock, it does not belong there.

New scoring or matching behaviour ships **with** its test in the same change.

### AI

- Model id lives only in `ai/client.ts`.
- Every AI call validates its output against a zod schema before the value
  escapes the `ai/` directory.
- AI output is a proposal. It never sets a status past `open`, and it never
  chooses a resource.

### Frontend

- Tailwind v4: theme tokens in `@theme` in `src/index.css`. There is no
  `tailwind.config.js`.
- Severity colours are `--color-sev-*`. Use them everywhere severity appears —
  map markers, badges, charts — so one colour change updates all three.
- Every async surface needs loading, empty, error, and success states. "It
  renders when the data is there" is not a finished component.
- Business logic goes in a hook or a service, not in JSX.

### Database

- A new table means a new migration file **and** its RLS policies in that same
  file. Never add a table the browser can reach without a policy.
- Migrations are append-only and numbered: `0002_*.sql`, `0003_*.sql`. Never edit
  a migration that has been applied anywhere.
- `status_history` is insert-only. No updates, no deletes.

---

## 5. Adding a feature — the checklist

1. Migration (schema + RLS + indexes) if the shape changes.
2. zod schema for the request and, if it comes from the AI, the response.
3. Pure engine function if there is a decision to make — with tests.
4. Route, with `requireAuth` / `requireRole`.
5. Frontend API call, hook, then component.
6. Loading / empty / error states.
7. `npm run test && npm run typecheck && npm run lint`.
8. Update the relevant doc in `docs/`.

---

## 6. Git

No commits on this repository yet. From here:

```bash
git add .
git commit -m "feat: <what changed>"
```

Conventional prefixes: `feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`.

Never commit: `.env`, `.env.local`, any key, `node_modules/`, `dist/`.
`.gitignore` already covers all of these — verify with `git status` before every
commit anyway.

---

## 7. Troubleshooting

**Backend exits immediately with "Invalid environment configuration"**
`backend/.env` is missing or incomplete. The message lists exactly which keys
failed. This is deliberate — a half-configured server in a disaster-response tool
is worse than one that refuses to start.

**Frontend white-screens on load**
`lib/supabase.ts` throws at module scope when `VITE_SUPABASE_URL` or
`VITE_SUPABASE_ANON_KEY` is missing, which kills the whole bundle. Check
`frontend/.env.local`, and restart Vite — env changes are not hot-reloaded.

**`Cannot find module './config'` in the backend**
Add the `.js` extension: `./config.js`. Required by `nodenext`, even though the
source file is `.ts`.

**`403 No profile for this account`**
The auth user exists but has no `profiles` row. The `on_auth_user_created`
trigger creates one automatically — if the user predates the migration, insert
the profile manually.

**Everything 401s from the browser**
The Supabase session is missing or expired. `lib/api.ts` attaches the token only
when a session exists; it does not currently redirect on 401 (Phase 1 work).

---

## 8. Repository map

```
backend/                Express API, AI layer, decision engine
frontend/               React SPA
supabase/migrations/    Schema, RLS policies, realtime publication
docs/                   This directory
CLAUDE.md               Constraints that override defaults — read it
```
