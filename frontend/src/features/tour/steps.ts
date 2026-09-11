/**
 * The demo, written down.
 *
 * A coordinator who uses TRIPTI daily learns this by doing it. Someone seeing
 * it for three minutes cannot, and the parts worth seeing are the ones that
 * need the most explaining — a plan that reports a shortage instead of hiding
 * it, a reallocation that refuses to touch a run someone already accepted.
 *
 * So each step names what to look at and, separately, why it is the
 * interesting part. The second half is the one people remember.
 */

export interface TourStep {
  /** Where this step happens. */
  path: string
  eyebrow: string
  title: string
  /** What to do on this screen. */
  action: string
  /** Why it is worth showing. The point of the step, not the mechanics. */
  point: string
}

export const TOUR_STEPS: TourStep[] = [
  {
    path: '/app',
    eyebrow: 'Step 1 of 7',
    title: 'Start with what is already known',
    action:
      'The board shows every open incident, and the impact figures underneath count only deliveries a coordinator has confirmed.',
    point:
      'A mission marked delivered but never verified counts as nothing here. Most dashboards would have counted it — which is how a demo number ends up three times larger than the truth.',
  },
  {
    path: '/app/incidents/new',
    eyebrow: 'Step 2 of 7',
    title: 'A report arrives as a sentence, not a form',
    action:
      'Type how someone would actually report an emergency — any language, no structure. Extraction pulls out category, severity, needs and a place name.',
    point:
      'Every extracted field carries a confidence score, and anything the model could not read is flagged rather than filled in. Without an API key it falls back to a keyword scan and marks the whole incident for manual triage — it degrades honestly instead of guessing.',
  },
  {
    path: '/app/incidents',
    eyebrow: 'Step 3 of 7',
    title: 'A person corrects the machine',
    action:
      'Open the incident, fix anything extraction got wrong, then press Geocode and choose a location from the candidates.',
    point:
      'Coordinates are never inferred from the report text. The system will hold a need out of every plan rather than place it by guesswork — a wrong coordinate sends a truck to the wrong place, and nothing downstream can detect that.',
  },
  {
    path: '/app/resources',
    eyebrow: 'Step 4 of 7',
    title: 'Supply arrives with an expiry',
    action:
      'List food or water with a quantity, a location, and — if it spoils — a perishable flag and expiry time.',
    point:
      'Expiry feeds the matcher directly, so stock closest to spoiling is offered first. Only perishable food counts as rescued later: tinned goods from a warehouse fed people, but nothing was saved from being thrown away.',
  },
  {
    path: '/app/planning',
    eyebrow: 'Step 5 of 7',
    title: 'The engine proposes, and shows its working',
    action:
      'Generate a plan. Open any match to see the score broken down — need priority, proximity, quantity fit, time fit, transport fit.',
    point:
      'No model decides this. It is a pure function that can be replayed months later and explain itself term by term. Note the coverage figure and the shortage list: the plan reports what it could not serve rather than quietly serving less.',
  },
  {
    path: '/app/missions',
    eyebrow: 'Step 6 of 7',
    title: 'Stock only moves when someone confirms it',
    action:
      'Approve the plan, assign a volunteer, then walk a mission through accepted, en route and delivered. Finally, verify it.',
    point:
      'A volunteer cannot verify their own delivery. If a courier could confirm their own drop, one person could manufacture every impact figure the platform reports — so the two roles are kept apart in the state machine itself.',
  },
  {
    path: '/app/reallocation',
    eyebrow: 'Step 7 of 7',
    title: 'Watch it refuse',
    action:
      'First file one more report, worse than anything on the board — a dam breach with thousands cut off — and triage it as critical. That is the real trigger: a plan is only ever wrong because something worse arrived after it. Then open Reallocate and read the moves it proposes, followed by the list of commitments it declined to touch, shown with equal weight.',
    point:
      'This is the part worth staying for. It will not take a run a volunteer has accepted, one already moving, one with a named volunteer, anything serving a life-critical need, or any donor it cannot identify. It also refuses to move for less than a 15-point priority gain, because below that it is just churn. Unknown always means protected.',
  },
]
