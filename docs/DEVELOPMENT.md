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
`supabase/migrations/` **in filename order**:

| File | What it does |
| ---- | ------------ |
| `0001_init.sql` | Tables, enums, RLS, realtime publication |
| `0002_roles.sql` | Renames `viewer`→`citizen`, adds `ngo` |
| `0003_auth_and_integrity.sql` | Role pinning, `updated_at` triggers, PII split, signup roles |

**Run `0002` on its own and let it commit before running `0003`.** Postgres does
not allow a newly added enum value to be used in the same transaction that added
it, and `0003` references `'ngo'`.

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

```bash
git add .
git commit -m "feat: <what changed>"
```

CI runs on every push and PR: install → lint → test → typecheck + build. A red
build blocks nothing automatically, but do not merge on top of one.

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

**`Cannot find module './config'` in the backend**
Add the `.js` extension: `./config.js`. Required by `nodenext`, even though the
source file is `.ts`.

**`403 No profile for this account`**
The auth user exists but has no `profiles` row. The `on_auth_user_created`
trigger creates one automatically — if the user predates the migration, insert
the profile manually.

**`Cannot build the frontend without VITE_SUPABASE_URL...`**
Working as intended. Vite inlines `VITE_` variables at build time, so a build
without them folds the app to a constant "not configured" branch and the
bundler removes everything behind it — a green build that ships a bundle which
can only ever render the setup screen, and which setting the variables on the
host afterwards cannot repair. `vite.config.ts` fails instead. Set the two
values (both public) in `.env.local` or in the CI/hosting environment.

**The app shows "TRIPTI is not configured yet"**
`frontend/.env.local` is missing or incomplete. The screen lists exactly which
variables to set. Restart Vite afterwards — env changes are not hot-reloaded.

**Signed in, but every role-gated screen says the role could not be confirmed**
The session is valid but `GET /api/profile` failed, so the browser has no
authoritative role and fails closed. Usually the backend is not running, or the
account has no `profiles` row.

**`infinite recursion detected in policy for relation "profiles"`**
Migration `0003` has not been applied. It replaces the recursive policy from
`0001` with a trigger.

---

## 8. Repository map

```
backend/                Express API, AI layer, decision engine
frontend/               React SPA — design system, auth, screens
supabase/migrations/    Schema, RLS policies, realtime publication
docs/                   This directory
.github/workflows/      CI: lint -> test -> typecheck -> build
CLAUDE.md               Constraints that override defaults — read it
```

## 9. Roles

Six roles, from the PRD. Four can be chosen at signup; two are granted.

| Role | Chosen at signup? | Granted by |
| ---- | ----------------- | ---------- |
| `citizen` | yes (default) | — |
| `volunteer` | yes | — |
| `donor` | yes | — |
| `ngo` | yes | — |
| `coordinator` | **no** | an admin, via `PATCH /api/profile/:id/role` |
| `admin` | **no** | an admin |

The clamp is enforced in three places on purpose: the signup form only offers
four options, `handle_new_user()` in the database ignores anything else, and the
`profiles_pin_role` trigger rejects a role change made with a user's own token.
