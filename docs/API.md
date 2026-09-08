# TRIPTI — API reference

Base URL `/api` (the Vite dev server proxies it to `http://localhost:4000`).
Every route except the health probes requires a bearer token.

```http
Authorization: Bearer <supabase access token>
```

The token is verified against Supabase and the caller's role is then read from
the `profiles` table. **A role in a JWT claim or a request header is ignored.**

---

## Conventions

| Aspect | Rule |
| ------ | ---- |
| Validation | zod at the route boundary. A failure returns `400` with a generic message — zod's own error is never echoed, because it describes internal field names |
| Errors | `{ "error": "message" }`. Deliberate failures carry a readable message; unexpected ones return `Internal server error` and the detail goes to the log |
| Timestamps | ISO 8601 UTC |
| Coordinates | `lat` and `lon` are always supplied together or not at all |
| Quantities | `null` means **unmetered** (a rescue team, a doctor), not zero |

### Status codes

| Code | Meaning |
| ---- | ------- |
| `200` / `201` / `204` | Success |
| `400` | Payload or query failed validation |
| `401` | Missing, invalid or expired token |
| `403` | Authenticated, but the role is not permitted |
| `404` | Not found — also returned instead of `403` where existence itself is private |
| `409` | Refused because it would break something already committed |
| `429` | Rate limited |
| `500` | Unexpected server error |

### Rate limits

| Scope | Limit |
| ----- | ----- |
| All `/api` routes | 120 requests / minute |
| `POST /api/incidents` | 10 / minute — it calls the Anthropic API on every request |

---

## Health

### `GET /health` · `GET /api/health`

Unauthenticated. Returns `{ "status": "ok" }` and nothing else — it is reachable
from anywhere, so it says nothing about the deployment.

---

## Profile

### `GET /api/profile`

The caller's own profile, including the authoritative `role`.

```json
{ "profile": { "id": "…", "full_name": "…", "phone": "…", "org": "…", "role": "coordinator", "created_at": "…" } }
```

### `PATCH /api/profile`

Body: any of `full_name`, `phone`, `org`.

`role` is deliberately absent. The database also pins it with a trigger, so this
is defence in depth rather than the only guard.

### `GET /api/profile/all` — coordinator, admin

Query: `role`, `limit` (1–200, default 50). Returns `{ "profiles": [...] }`.

### `PATCH /api/profile/:id/role` — admin

Body: `{ "role": "coordinator" }`. The only path that can produce a `coordinator`
or an `admin`; signup clamps itself to the four self-service roles.

---

## Incidents

### `GET /api/incidents`

Query: `status` (`open` | `triaged` | `assigned` | `resolved`), `limit` (1–200).

Citizens and donors receive only the incidents they reported. Volunteers, NGOs,
coordinators and admins receive the whole board.

### `POST /api/incidents` — rate limited, 10/min

```json
{
  "report_text": "Flooding near Sector 62. Around 300 people affected, food and drinking water urgently needed.",
  "reporter_phone": "+91…",
  "lat": 28.6139,
  "lon": 77.2090
}
```

`report_text` is 10–10 000 characters. `lat`/`lon` are optional but must appear
together.

Runs AI extraction, writes the incident with `status: "open"`, inserts the
extracted needs, files an audit entry, and stores `reporter_phone` in the
backend-only `incident_contacts` table.

**`201`**

```json
{
  "incident": { "id": "…", "severity": "critical", "ai_confidence": 0.82, "ai_unclear": ["…"], "status": "open" },
  "extracted": { "summary": "…", "category": "flood", "needs": [{ "kind": "water", "quantity": 600, "unit": "litres" }] }
}
```

The extraction is a **proposal**. Nothing advances past `open` on the strength of
a model response.

### `GET /api/incidents/:id`

Returns the incident with its needs and its full status history. Visible to the
reporter and to any operational role; anyone else gets `404` rather than `403`,
because whether an incident exists is itself private.

### `PATCH /api/incidents/:id` — coordinator, admin

Body: any of `severity`, `status`, `lat`+`lon`, `note`. Human override of the
AI's classification. A status change writes an audit entry, and `note` is stored
on it.

---

## Needs

### `GET /api/needs`

Query: `incident_id`, `status`, `kind`, `limit` (1–200, default 100). Each need
is returned with a summary of its incident.

### `POST /api/needs` — coordinator, admin

```json
{ "incident_id": "…", "kind": "water", "quantity": 600, "unit": "litres", "note": "…" }
```

Needs normally arrive from extraction. This is the human path — adding what the
report did not say, or correcting what it did.

### `PATCH /api/needs/:id` — coordinator, admin

Body: any of `quantity`, `unit`, `note`, `status`.

---

## Resources

The supply pool. Food is not a separate subsystem: it is a resource with
`kind: "food"`, `perishable: true` and an `expiry_time`.

### `GET /api/resources`

| Query | Meaning |
| ----- | ------- |
| `kind` | One of water, food, shelter, medical, rescue, evacuation, clothing, sanitation, power, other |
| `status` | available, committed, depleted, offline |
| `usable` | `true` hides anything past its deadline |
| `mine` | `true` restricts to the caller's own listings |
| `limit` / `offset` | Pagination; default 50 / 0 |

Donors and citizens see only their own listings. Volunteers, NGOs, coordinators
and admins see the whole pool, because they plan against it.

```json
{
  "resources": [{
    "id": "…", "label": "Cooked meals — Sector 18 kitchen", "kind": "food",
    "quantity": 400, "reserved_quantity": 120, "available_quantity": 280,
    "unit": "meals", "perishable": true, "expiry_time": "2026-09-08T20:00:00Z",
    "expired": false, "lat": 28.57, "lon": 77.32, "status": "available"
  }],
  "total": 1
}
```

`available_quantity` is `quantity − reserved_quantity` and is what the matcher
may draw on. Reading `quantity` alone is how the same units get promised twice.

### `POST /api/resources` — donor, ngo, volunteer, coordinator, admin

```json
{
  "label": "Cooked meals — Sector 18 kitchen",
  "kind": "food",
  "quantity": 400,
  "unit": "meals",
  "address": "…",
  "lat": 28.57,
  "lon": 77.32,
  "perishable": true,
  "expiry_time": "2026-09-08T20:00:00Z"
}
```

`perishable: true` requires an `expiry_time`, and an `expiry_time` already in the
past is refused with `409`.

### `PATCH /api/resources/:id` — owner, coordinator, admin

Any of `label`, `description`, `quantity`, `unit`, `address`, `lat`+`lon`,
`expiry_time`, `perishable`, `status`. `kind` is immutable — changing it would
silently invalidate every match made against the resource.

Reducing `quantity` below `reserved_quantity` returns **`409`**: those units are
already promised, and the matches have to be released first.

### `DELETE /api/resources/:id` — owner, coordinator, admin

`204` on success. Returns **`409`** when a live match is holding the resource,
rather than cascading it away and leaving a volunteer collecting nothing.

---

## Matching

### `POST /api/match/preview` — coordinator, admin

Read-only. Runs the deterministic engine over unmet needs and available
resources and returns a plan for a coordinator to approve. Creating missions is
a separate, explicit action.

```json
{
  "matches": [{ "needId": "…", "resourceId": "…", "quantity": 300, "distanceKm": 4.2, "needPriority": 168.5 }],
  "needsMissingCoordinates": ["…"]
}
```

Needs without coordinates cannot be ranked by distance, so they are **excluded
from the plan and returned separately** for manual handling — never silently
dropped.

---

## Not built yet

`POST /api/missions`, mission state transitions, volunteer and vehicle
assignment, routing, reallocation, and analytics. Those land in phases 4–8; this
document is updated in the same change as the code, never ahead of it.
