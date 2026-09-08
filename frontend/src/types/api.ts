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
