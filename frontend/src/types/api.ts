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
