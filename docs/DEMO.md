# TRIPTI — Demo script

A twelve-minute walkthrough that ends on the thing worth showing: taking a
delivery away from one group of people and giving it to another, with the system
explaining why and refusing to touch what it must not.

```bash
npm run seed -- --reset     # clears and rebuilds the demo data
npm run dev                 # api on :4000, web on :5173
```

Every seeded row is labelled `DEMO` and every account is on `@tripti.demo`, so
demo data is always distinguishable from real data and `--reset` can remove it
without guessing.

| Account | Role |
| --- | --- |
| `coordinator@tripti.demo` | Emergency operator — sees everything |
| `volunteer@tripti.demo` | Sees only their own runs |
| `donor@tripti.demo` | Sees only their own resources |
| `citizen@tripti.demo` | Reports, and sees their own reports |

Password for all four: `demo-tripti-2026`

---

## 1. A report arrives (2 min)

Sign in as **citizen**. *Report an incident*. Paste, or type your own:

> Flooding near Sector 62 since last night. Around 300 people are stranded on
> upper floors, including elderly residents. Food and drinking water are
> urgently needed.

Submit, and show the review screen.

**What to point at:**

- Structured fields pulled out of free text — summary, category, severity,
  needs.
- **The confidence figure and the "unclear" flags**, shown beside the fields
  they concern rather than buried.
- **`location_text` is filled; latitude and longitude are empty.** The model
  never invents a coordinate. A wrong coordinate sends a truck somewhere real;
  a missing one stops and asks a person.
- Status is `open`. Nothing dispatches on a model's say-so.

Without an Anthropic key this still works — the deterministic fallback runs and
reports confidence 0, which the UI shows as *nothing has read this yet*. Say so
out loud; a system that degrades instead of failing is the point.

---

## 2. Triage (2 min)

Sign in as **coordinator**. Open the incident.

- Geocode the location — candidates are offered, a human picks. The lookup
  writes nothing on its own.
- Show the **priority breakdown**: five weighted terms, the points each
  contributed, and the total. This is the answer to "why is this one above that
  one", and it exists because a coordinator will be asked.
- Set the headcount if extraction left it blank. It usually will have, because
  "around 300" is a hedge a keyword scan will not resolve — and that number
  feeds every impact figure later.

---

## 3. Plan and dispatch (3 min)

*Planning* → generate a response plan.

**What to point at:**

- Matches with a score and a written rationale per pairing.
- **Coverage per need**, and the shortage list. A need that cannot be met says
  so.
- **`needsMissingCoordinates`** — anything unlocated is excluded from the plan
  and listed for manual handling, never silently dropped.

Approve the plan. Stock moves from available to reserved.

Then on *Missions*: assign a volunteer, and sign in as them in another window
to advance `accepted → en_route → delivered`.

**The thing to say here:** a volunteer can take a mission as far as
`delivered`. Only a coordinator can mark it `verified`. That is not bureaucracy
— impact figures are counted only from verified deliveries, so letting a courier
confirm their own delivery would let one person manufacture the numbers the
platform reports.

Back as coordinator: verify it. Watch the stock actually decrease.

---

## 4. Reallocation (3 min) — the climax

A second, worse incident arrives while the first is still being served.

Sign in as **citizen** in the other window and report:

> Dam overflow at the north embankment. Around 4000 people cut off with no
> drinking water. Children and elderly among them.

As **coordinator**: triage and geocode it, then open *Reallocate*.

**What to point at, in this order:**

1. **What it proposes to move**, each with a before/after priority and the gain.
2. **What it refuses to touch, shown with equal weight.** A run a volunteer has
   accepted. A run with a named volunteer even before they accept — they may
   already be planning their day around it. Anything life-critical, however low
   it scores.
3. **The churn gate.** A move must gain at least 15 priority points. Shuffling
   between two similar needs is churn, and churn in a real response means
   trucks turning around.
4. **What it still cannot serve**, stated rather than hidden.

Approve it. Then show that the donor's mission was cancelled, a new mission was
created for the receiving need, and the reservation never left the pool — the
same units stay held against the same resource; only the need they are promised
to changes.

**Say this:** each move is re-checked at the moment it is applied, not trusted
from the proposal. If a volunteer accepted that run between the coordinator
reading the screen and pressing approve, **the volunteer wins**, and the move is
skipped and reported.

---

## 5. Impact (2 min)

Back to the dashboard.

**What to point at:**

- **Confirmed deliveries only.** A mission someone marked delivered but nobody
  verified is not counted.
- **People counted once per incident.** Verify a second delivery to the same
  incident and show the figure not moving. Three deliveries to one flood of 300
  helped 300, not 900 — and summing per mission is the easiest way to publish a
  number three times too large.
- **Median response, measured to the first delivery.** A top-up two days later
  did not make the response slower, and one mission that sat unverified over a
  weekend should not drag the headline figure.
- **Food rescued counts perishable food only.** Tinned goods from a warehouse
  fed people, but nothing was saved from being thrown away.
- **A kind delivered in mixed units reports no total.** Six bottles and four
  litres of water is not "ten" of anything.
- **"1 incident gave no headcount"** where it applies. The gap is stated, not
  quietly counted as zero.

Sign in as **citizen** and reload: the achievement figures are there, the pool
utilisation is not. What was achieved is shareable; how much slack the response
has is operational posture.

---

## 6. If you have another two minutes

**Concurrency.** Fire five simultaneous 3000-unit reservations at a resource
with 11,400 free. Exactly three are granted. The check and the write happen in
one SQL statement, so two coordinators planning at the same moment cannot
promise the same truck twice.

**The audit trail.** `status_history` is append-only — never updated, never
deleted. A post-incident review has to reconstruct what was known when, and a
record that can be edited afterwards cannot support that.

---

## Questions that get asked

**"Is the AI deciding who gets help?"** No. It reads free text into structured
fields. Allocation is deterministic, unit-tested, and explainable term by term.
That is `docs/AI.md` in one sentence: the model reads, the engine decides, the
human approves.

**"What happens when the AI is down?"** Extraction falls back to a keyword scan
and everything else keeps working. Reports arrive marked as unread by the model
for a coordinator to handle. Matching and dispatch never touch the model at all.

**"Could someone game the impact numbers?"** Only a coordinator can verify a
delivery, and only verified deliveries count. A courier cannot confirm their
own.

**"What if it gets the location wrong?"** It does not guess one. Unlocated needs
are excluded from planning and listed for manual handling.
