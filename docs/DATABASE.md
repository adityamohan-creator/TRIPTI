# TRIPTI — Database

Supabase Postgres. Every table has row level security enabled, because the
browser holds only the anon key and anything it can reach is reachable by anyone
who opens the console.

---

## Running the migrations

In the Supabase SQL editor, in filename order:

| File | Contents |
| ---- | -------- |
| `0001_init.sql` | Enums, profiles, incidents, needs, resources, missions, status_history, RLS, realtime |
| `0002_roles.sql` | `viewer` → `citizen`, adds `ngo` |
| `0003_auth_and_integrity.sql` | Role pinning, `updated_at` triggers, PII split, signup roles, `current_user_role()` |
| `0004_operations.sql` | Volunteers, vehicles, matches, mission stops, routes, impact metrics, notifications |

> **Run `0002` on its own and let it commit before `0003`.** Postgres refuses to
> use an enum value in the same transaction that added it, and `0003` references
> `'ngo'`.

Migrations are append-only. Never edit one that has been applied anywhere; add
`0005_*.sql` instead.

---

## Shape

```
auth.users
    │ 1:1 (trigger on signup)
    ▼
profiles ──────────────┬──────────────┬─────────────────┐
  role                 │              │                 │
                       ▼              ▼                 ▼
                  volunteers ───► vehicles         notifications
                       │
incidents ──1:N──► needs ──1:N──► matches ──N:1──► resources
    │                                  │                │
    │                                  ▼                │
    │                             missions ──1:N──► mission_stops
    │                                  │
    │                                  ├──1:1──► routes
    │                                  │
    ├──────────────► impact_metrics ◄──┘
    │
    └──1:1──► incident_contacts        (backend-only: no RLS policy)

status_history — append-only, every entity type
```

---

## Enums

| Type | Values |
| ---- | ------ |
| `user_role` | citizen, volunteer, donor, ngo, coordinator, admin |
| `severity` | low, medium, high, critical |
| `incident_status` | open, triaged, assigned, resolved |
| `need_status` | unmet, partial, met, cancelled |
| `resource_status` | available, committed, depleted, offline |
| `mission_status` | proposed, accepted, en_route, delivered, failed, cancelled |
| `match_status` | proposed, reserved, committed, released, fulfilled |
| `availability` | available, busy, offline |
| `vehicle_type` | bike, car, van, truck, boat, other |
| `stop_kind` | pickup, dropoff |

---

## Rules the schema enforces

These are constraints, not conventions — the database refuses the bad state
rather than trusting every future caller to remember.

**A resource cannot be over-promised.**
`reserved_quantity >= 0` and `reserved_quantity <= quantity`. Availability is
always `quantity − reserved_quantity`; reading `quantity` alone is how one truck
gets promised to two places.

**A user cannot change their own role.**
The `profiles_pin_role` trigger rejects any role change made with a user's own
token. `handle_new_user()` clamps a signup to the four self-service roles, so a
crafted payload asking for `admin` still lands as `citizen`. Grants go through
the service-role backend after `requireRole('admin')`.

**Reporter contact details are unreachable from the browser.**
`incident_contacts` has RLS enabled and **no policies at all**. No policy means
no row is visible through the anon key under any circumstance, and nothing leaks
through a realtime payload either. Only the service-role backend reads it.

**One live match per need/resource pair.**
A partial unique index covers only `proposed`, `reserved` and `committed`.
Released and fulfilled rows are history and may repeat.

**An impact metric has a subject.**
`incident_id` or `mission_id` must be present. An unattributed impact number is
a number nobody can check.

**Perishable stock has a deadline.**
Enforced at the API boundary rather than in SQL, because `perishable` is only
meaningful alongside `expiry_time` when a human is publishing the row.

**`updated_at` is real.**
`set_updated_at()` fires before update on incidents, missions, resources,
volunteers, vehicles and matches. It used to be set once at insert and never
touched again, which made every "last changed" display wrong.

---

## The audit trail

`status_history` is **insert-only**. No updates, no deletes, no exceptions.

```sql
entity_type  incident | need | resource | mission
entity_id    uuid
from_status  null when the entity is being created
to_status    text
changed_by   uuid → profiles
note         text
changed_at   timestamptz
```

`backend/src/lib/history.ts` is the only writer. It deliberately never throws:
a failed audit write must not roll back a delivery that actually happened or
block a coordinator mid-incident. It logs loudly instead, so the gap is visible
without costing anyone a response.

A post-incident review has to be able to reconstruct what was known when. A
mutable audit table cannot do that.

---

## Row level security

The browser reads through RLS; the backend bypasses it entirely with the service
role key and does its own checks in `middleware/auth.ts` and the service layer.

| Table | Browser can read | Browser can write |
| ----- | ---------------- | ----------------- |
| `profiles` | Own row; coordinators and admins read all | Own row, except `role` |
| `incidents` | Own reports; volunteers, NGOs, coordinators, admins read all | No |
| `incident_contacts` | **Nothing** | No |
| `needs` | Any authenticated user | No |
| `resources` | Any authenticated user | Own rows; coordinators and admins all |
| `matches` | Volunteers, NGOs, coordinators, admins | No |
| `missions` | Any authenticated user | Assignees update their own |
| `mission_stops`, `routes` | Volunteers, NGOs, coordinators, admins | No |
| `volunteers` | Own row; coordinators and admins read all | Own row |
| `vehicles` | Volunteers, NGOs, coordinators, admins | Own rows |
| `impact_metrics` | Any authenticated user | No |
| `notifications` | Own rows | Own rows, but a trigger pins the content so only `read_at` really changes |
| `status_history` | Any authenticated user | No |

Role checks in policies call `current_user_role()`, a `SECURITY DEFINER` helper
that reads `profiles` outside RLS. Policies must never subquery their own table:
the original `profiles` update policy did exactly that and made Postgres raise
`infinite recursion detected in policy for relation "profiles"`, which broke
every browser-side profile update.

---

## Realtime

Published to `supabase_realtime`: `incidents`, `needs`, `missions`, `matches`,
`resources`, `notifications`.

Subscribers should treat an event as *"something changed, refetch"* rather than
trusting the payload — that way the browser never renders a row it would not
have been allowed to read.

---

## Coordinates

Plain `double precision` `lat`/`lon`, not PostGIS. Ranking uses a haversine
distance in the matching engine, which is accurate enough for choosing between
candidates, and routing supplies real distances later. Enable the `postgis`
extension and move to `geography(Point)` when radius queries get heavy.

Coordinates are never inferred. Extraction copies the place name into
`location_text` and leaves `lat`/`lon` null; geocoding is a separate explicit
step. Rows without coordinates are excluded from the match plan and returned for
manual handling — a wrong coordinate in a disaster sends a truck to the wrong
place.

---

## Types in the application

`backend/src/types/db.ts` mirrors these tables by hand. `supabase gen types`
needs a live project and a linked CLI, which a fresh clone does not have — when
the project is provisioned, generate the file and delete the hand-written one.
Until then, a migration that changes a column changes that file in the same
commit.
