# TRIPTI — Testing

```bash
npm run test        # 182 tests, ~1s
npm run typecheck   # backend tsc, then frontend tsc -b via build
npm run lint        # oxlint on the frontend
npm run health      # checks the live Supabase project end to end
```

One file: `npm --prefix backend run test -- src/engine/match.test.ts`

---

## 1. What is tested, and what that is worth

The engine has real coverage — 182 tests across twelve files, all of it pure
functions with no I/O. Start there when changing allocation behaviour.

| File | Covers |
| --- | --- |
| `engine/priority.test.ts` | PRD weights, bands, per-term breakdown |
| `engine/match.test.ts` | Scoring, greedy allocation, unmetered claims |
| `engine/overcommit.test.ts` | The same resource never promised twice |
| `engine/inventory.test.ts` | Availability arithmetic |
| `engine/assignment.test.ts` | Volunteer and vehicle ranking |
| `engine/missionLifecycle.test.ts` | State machine, who may make each move, stock effects |
| `engine/reallocation.test.ts` | What may and may not be taken |
| `engine/impact.test.ts` | Dedupe, medians, unit handling, unmetered |
| `services/coverage.test.ts` | Coverage percentage per need |
| `ai/extractIncident.test.ts` | Schema revalidation, fallback behaviour |

---

## 2. The thing this project learned the hard way

**A green test suite has hidden a real bug here at least five times.** This is
the most useful thing in this document.

| Bug | Tests said |
| --- | --- |
| Production builds shipped an empty 352 KB app for three phases | all green |
| Coverage reported 100% while a need was unmatched | all green |
| Citizens and donors could read the whole dispatch board | all green |
| Reallocation silently lost its two most important safety checks | all green |
| Reallocation reported success while moving nothing | all green |

Every one surfaced by running the real system against the real database. None
would have been caught by adding more unit tests, because each was a wrong
assumption about the world — what the bundler does with an unset env var, what
`loadPool` returns, what the SQL function accepts — and a unit test encodes the
same assumption in the fixture.

**So: after any change that touches data flow, run it.** Sign in, click the
thing, read the row back out of Postgres. The suite tells you the engine is
still correct. It cannot tell you the engine is still connected.

---

## 3. Where the real verification happens

`npm run health` checks the live project: env vars present and not placeholders,
frontend and backend pointing at the *same* Supabase project (a hand-typed
project ref differing by one character cost an afternoon), migrations applied,
auth reachable, RLS behaving.

Beyond that, these are the end-to-end paths worth re-running after a change in
their area. Each has been run against the live project and is described in
`DEMO.md`:

- **Concurrency** — five simultaneous 3000-unit reservations against 11,400
  free units grant exactly three. Proves D7 closed under real contention, which
  no single-threaded test can.
- **Lifecycle** — a mission through `proposed → accepted → en_route →
  delivered → verified`, checking stock actually moves (12,000 → 11,400).
- **Reallocation** — approve, then confirm the donor mission was cancelled, a
  receiving mission created, and the reservation unchanged.
- **Impact dedupe** — verify a second delivery to the same incident and confirm
  `peopleHelped` does **not** move. Three deliveries to one flood of 300 helped
  300, not 900, and this is the check that proves it in production rather than
  in a fixture.

---

## 4. Conventions

**Test names describe behaviour, not functions.** `'never takes from a
life-critical need, however low its score'`, not `'isReleasable returns false'`.
When one fails, the name should say what broke for a user.

**Comments explain the stake, not the mechanics.** The reallocation suite says
*why* an unknown donor need must fail closed — because every check that reads it
silently passes otherwise. That comment is worth more than the assertion.

**Every engine suite asserts determinism and purity.** Same input, same output;
inputs are never mutated. Both are load-bearing: the matcher is re-run
constantly against a live pool.

**Fixtures are builders with overrides** (`need({ severity: 'critical' })`), so
a test states only what it is about.

---

## 5. Not tested

Named rather than implied.

- **No route-level integration tests.** Auth and validation are exercised by
  hand and by `health`, not by a suite. This is the largest gap.
- **No frontend component tests.** Vitest is configured in the backend only.
- **No SQL function tests.** `reserve_resource`, `assign_mission` and
  `reallocate_match` are verified by running them against the live database.
  The reallocation bug in 0011 — the function accepted only two of the three
  statuses it needed — is exactly what a test here would have caught.
- **No load testing.**
