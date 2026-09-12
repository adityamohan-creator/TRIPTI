/**
 * What a crisis report is *about*, as an operational category.
 *
 * ## These are TRIPTI's own categories, not TREC-IS labels
 *
 * Stated plainly because the distinction matters and is easy to blur. The
 * official TREC-IS information-type taxonomy is not implemented here, and no
 * output of this module should be described as a TREC-IS label. Doing so would
 * be a claim about conformance to a published standard that has not been read,
 * let alone verified.
 *
 * `TrecIsMapping` below is the seam where the official taxonomy plugs in once
 * the dataset and its label set are actually available.
 *
 * ## Separate from `incidents.category`
 *
 * TRIPTI already has a `category` field, and it answers a different question:
 * what *kind of disaster* this is — flood, earthquake, fire. This answers what
 * a *single report* is telling you — that a road is out, that someone needs
 * rescuing, that supplies are available.
 *
 * One earthquake produces reports of casualties, of collapsed buildings, of
 * shelter needs and of volunteers offering help. Collapsing those into the
 * disaster type would throw away the thing a coordinator is triaging on, so
 * the two live side by side and neither replaces the other.
 */

export const INFORMATION_TYPES = [
  'infrastructure_damage',
  'casualty_or_injury',
  'flooding',
  'fire',
  'shelter_need',
  'food_need',
  'water_need',
  'medical_need',
  'evacuation',
  'rescue_request',
  'resource_availability',
  'other',
] as const

export type InformationType = (typeof INFORMATION_TYPES)[number]

/** Human labels for the UI. Kept beside the codes so they cannot drift apart. */
export const INFORMATION_TYPE_LABELS: Record<InformationType, string> = {
  infrastructure_damage: 'Infrastructure damage',
  casualty_or_injury: 'Casualty or injury',
  flooding: 'Flooding',
  fire: 'Fire',
  shelter_need: 'Shelter needed',
  food_need: 'Food needed',
  water_need: 'Water needed',
  medical_need: 'Medical needed',
  evacuation: 'Evacuation',
  rescue_request: 'Rescue requested',
  resource_availability: 'Resource offered',
  other: 'Other',
}

/**
 * Where the official taxonomy will attach.
 *
 * Deliberately empty. A guessed mapping is worse than none: it would let
 * everything downstream report a TREC-IS category that no TREC-IS file ever
 * defined, and nothing in the pipeline would be able to tell.
 */
export interface TrecIsMapping {
  /** TRIPTI category → official label, once the official set is in hand. */
  toOfficial(type: InformationType): string | null
  /** Official label → TRIPTI category, for loading labelled data. */
  fromOfficial(label: string): InformationType | null
}

export const UNMAPPED_TRECIS: TrecIsMapping = {
  toOfficial: () => null,
  fromOfficial: () => null,
}

/**
 * Which categories describe a need someone has, rather than an observation.
 *
 * Used by the priority scorer: "we need water" and "water is available" are
 * both about water and are opposite operational facts.
 */
export const NEED_TYPES: ReadonlySet<InformationType> = new Set([
  'shelter_need',
  'food_need',
  'water_need',
  'medical_need',
  'rescue_request',
  'evacuation',
])

/** Categories that imply someone is in immediate danger. */
export const LIFE_THREATENING: ReadonlySet<InformationType> = new Set([
  'casualty_or_injury',
  'rescue_request',
  'medical_need',
  'evacuation',
])

export function isInformationType(value: string): value is InformationType {
  return (INFORMATION_TYPES as readonly string[]).includes(value)
}
