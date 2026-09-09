/**
 * Shapes the backend actually returns. Hand-mirrored from `backend/src` for now;
 * when Supabase types are generated in Phase 2 the row types below should be
 * derived from them rather than restated.
 */

export const ROLES = [
  'citizen',
  'volunteer',
  'donor',
  'ngo',
  'coordinator',
  'admin',
] as const
export type Role = (typeof ROLES)[number]

/** Roles a user may pick for themselves. Mirrors handle_new_user() in the DB. */
export const SELF_SERVICE_ROLES = ['citizen', 'volunteer', 'donor', 'ngo'] as const
export type SelfServiceRole = (typeof SELF_SERVICE_ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  citizen: 'Citizen',
  volunteer: 'Volunteer',
  donor: 'Food donor',
  ngo: 'NGO / Shelter',
  coordinator: 'Emergency operator',
  admin: 'Administrator',
}

export const ROLE_DESCRIPTIONS: Record<SelfServiceRole, string> = {
  citizen: 'Report emergencies and follow what happens to your reports.',
  volunteer: 'Accept missions, deliver supplies, update status from the field.',
  donor: 'List surplus food and supplies with a collection deadline.',
  ngo: 'Publish shelter capacity and resources, and request support.',
}

export type Severity = 'low' | 'medium' | 'high' | 'critical'
export const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical']

export type IncidentStatus = 'open' | 'triaged' | 'assigned' | 'resolved'
export type NeedStatus = 'unmet' | 'partial' | 'met' | 'cancelled'
export type ResourceStatus = 'available' | 'committed' | 'depleted' | 'offline'
export type MissionStatus =
  | 'proposed'
  | 'accepted'
  | 'en_route'
  | 'delivered'
  | 'verified'
  | 'failed'
  | 'cancelled'

export interface Profile {
  id: string
  full_name: string | null
  phone: string | null
  org: string | null
  role: Role
  created_at: string
}

export interface Need {
  id: string
  incident_id: string
  kind: string
  quantity: number | null
  unit: string | null
  note: string | null
  status: NeedStatus
  created_at: string
}

export type ExtractionSource = 'model' | 'fallback'

export interface Incident {
  id: string
  report_text: string
  reported_by: string | null
  summary: string | null
  category: string | null
  severity: Severity
  location_text: string | null
  people_affected: number | null
  source_language: string | null
  ai_confidence: number | null
  ai_unclear: string[]
  /** model = an LLM read the report. fallback = keyword scan only. */
  ai_source: ExtractionSource
  ai_provider: string | null
  ai_degraded_reason: string | null
  vulnerable_groups: string[]
  lat: number | null
  lon: number | null
  status: IncidentStatus
  triaged_by: string | null
  created_at: string
  updated_at: string
  needs?: Need[]
}

export interface StatusHistoryEntry {
  id: number
  from_status: string | null
  to_status: string
  changed_by: string | null
  note: string | null
  changed_at: string
}

export const RESOURCE_KINDS = [
  'water',
  'food',
  'shelter',
  'medical',
  'rescue',
  'evacuation',
  'clothing',
  'sanitation',
  'power',
  'other',
] as const
export type ResourceKind = (typeof RESOURCE_KINDS)[number]

export interface Resource {
  id: string
  owner_id: string | null
  label: string
  description: string | null
  kind: string
  /** Null means unmetered: a rescue team, a doctor, a boat. */
  quantity: number | null
  unit: string | null
  reserved_quantity: number
  address: string | null
  lat: number | null
  lon: number | null
  expiry_time: string | null
  perishable: boolean
  status: ResourceStatus
  created_at: string
  updated_at: string
  /** quantity - reserved_quantity, computed by the backend. */
  available_quantity: number | null
  expired: boolean
}

/** Roles allowed to publish supply. Mirrors CAN_CREATE in the resources service. */
export const CAN_PUBLISH_RESOURCES: readonly Role[] = [
  'donor',
  'ngo',
  'volunteer',
  'coordinator',
  'admin',
]

export type PriorityLevel = 'routine' | 'elevated' | 'high' | 'critical'

export interface PriorityTerm {
  key: string
  label: string
  normalised: number
  weight: number
  points: number
  detail: string
}

export interface PriorityBreakdown {
  score: number
  level: PriorityLevel
  terms: PriorityTerm[]
}

export interface IncidentDetail {
  incident: Incident
  /** Keyed by need id. */
  priorities: Record<string, PriorityBreakdown>
  history: StatusHistoryEntry[]
}

export interface ExtractionResponse {
  incident: Incident
  extraction: {
    summary: string
    category: string
    severity: Severity
    location_text: string | null
    people_affected: number | null
    needs: { kind: string; quantity: number | null; unit: string | null; note: string | null }[]
    vulnerable_groups: string[]
    source_language: string
    confidence: number
    unclear: string[]
  }
  source: ExtractionSource
  degradedReason?: string
}

// ------------------------------------------------------------ matching

export interface MatchTerm {
  key: string
  label: string
  normalised: number
  weight: number
  points: number
  detail: string
}

export interface ProposedMatch {
  needId: string
  resourceId: string
  quantity: number | null
  distanceKm: number
  score: number
  needPriority: number
  terms: MatchTerm[]
}

export interface PlanPreview {
  matches: ProposedMatch[]
  unmatched: { needId: string; reason: string }[]
  needsMissingCoordinates: string[]
  resourcesMissingCoordinates: string[]
  /** 0-1. */
  coverage: number
  weights: Record<string, number>
}

export type PlanStatus = 'proposed' | 'approved' | 'discarded'

export interface ResponsePlan {
  id: string
  label: string | null
  status: PlanStatus
  weights: Record<string, number>
  unmatched: { needId: string; reason: string }[]
  coverage: number | null
  created_by: string | null
  approved_by: string | null
  approved_at: string | null
  note: string | null
  created_at: string
  updated_at: string
}

/** A stored match, joined to the need and resource it pairs. */
export interface PlanMatch {
  id: string
  need_id: string
  resource_id: string
  score: number
  allocated_quantity: number | null
  distance_km: number | null
  rationale: { needPriority?: number; terms?: MatchTerm[] } | null
  status: string
  needs?: {
    kind: string
    unit: string | null
    incidents?: { summary: string | null; severity: Severity; location_text: string | null } | null
  } | null
  resources?: {
    label: string
    kind: string
    unit: string | null
    address: string | null
    expiry_time: string | null
    perishable: boolean
  } | null
}

export interface PlanDetail {
  plan: ResponsePlan
  matches: PlanMatch[]
}

// ---------------------------------------------------------------- fleet

export type Availability = 'available' | 'busy' | 'offline'
export const AVAILABILITY: Availability[] = ['available', 'busy', 'offline']

export const VEHICLE_TYPES = ['bike', 'car', 'van', 'truck', 'boat', 'other'] as const
export type VehicleType = (typeof VEHICLE_TYPES)[number]

/** Skills the assigner can require. Free text is allowed; these are the common ones. */
export const COMMON_SKILLS = [
  'driving',
  'first-aid',
  'swimming',
  'lifting',
  'local-knowledge',
  'translation',
  'medical',
] as const

export interface Volunteer {
  user_id: string
  skills: string[]
  vehicle_id: string | null
  availability: Availability
  lat: number | null
  lon: number | null
  max_concurrent_missions: number
  notes: string | null
  updated_at: string
  profiles?: { full_name: string | null; phone: string | null; role: Role } | null
}

export interface Vehicle {
  id: string
  owner_id: string | null
  label: string
  type: VehicleType
  capacity_kg: number | null
  capacity_units: number | null
  refrigerated: boolean
  availability: Availability
  lat: number | null
  lon: number | null
  updated_at: string
}

// -------------------------------------------------------------- missions

export interface Mission {
  id: string
  plan_id: string | null
  need_id: string
  resource_id: string
  assigned_to: string | null
  vehicle_id: string | null
  quantity: number | null
  distance_km: number | null
  need_priority: number | null
  status: MissionStatus
  route: {
    distanceKm: number
    durationMin: number
    estimated: boolean
    provider: string
    geometry: { type: 'LineString'; coordinates: [number, number][] } | null
  } | null
  created_at: string
  needs?: {
    kind: string
    unit: string | null
    incidents?: {
      summary: string | null
      severity: Severity
      location_text: string | null
      lat: number | null
      lon: number | null
    } | null
  } | null
  resources?: {
    label: string
    kind: string
    unit: string | null
    address: string | null
    lat: number | null
    lon: number | null
    expiry_time: string | null
    perishable: boolean
  } | null
}

export interface AssignmentTerm {
  key: string
  label: string
  normalised: number
  weight: number
  points: number
  detail: string
}

export interface AssignmentCandidate {
  volunteerId: string
  volunteerName: string | null
  vehicleId: string | null
  vehicleLabel: string | null
  distanceToPickupKm: number | null
  estimatedMinutes: number | null
  score: number
  terms: AssignmentTerm[]
}

export interface CandidateResponse {
  candidates: AssignmentCandidate[]
  excluded: { volunteerId: string; name: string | null; reason: string }[]
}

/** A move the current user may make on a mission, from the state machine. */
export interface MissionAction {
  to: MissionStatus
  actors: ('assignee' | 'coordinator')[]
  label: string
  detail: string
  destructive?: boolean
}

export interface MissionActions {
  status: MissionStatus
  actions: MissionAction[]
}

// -------------------------------------------------------- reallocation

export interface ReallocationMove {
  resourceId: string
  quantity: number | null
  fromNeedId: string
  fromPriority: number
  toNeedId: string
  toPriority: number
  priorityGain: number
  matchId: string
  distanceKm: number
  score: number
  rationale: string
}

export interface ReallocationPreview {
  moves: ReallocationMove[]
  /** What was deliberately not moved. Shown with equal weight to the moves. */
  protectedCommitments: { matchId: string; needId: string; reason: string }[]
  stillUnserved: { needId: string; reason: string }[]
  minPriorityGain: number
  needsMissingCoordinates: string[]
}

export interface Reallocation {
  id: string
  label: string | null
  status: 'proposed' | 'approved' | 'discarded'
  moves: ReallocationMove[]
  protected_commitments: { matchId: string; needId: string; reason: string }[]
  still_unserved: { needId: string; reason: string }[]
  min_priority_gain: number | null
  triggered_by_incident: string | null
  created_by: string | null
  approved_by: string | null
  approved_at: string | null
  note: string | null
  created_at: string
}
