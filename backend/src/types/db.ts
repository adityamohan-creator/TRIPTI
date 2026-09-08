/**
 * Row shapes for the tables this service touches.
 *
 * Hand-written rather than generated: `supabase gen types` needs a live project
 * and a linked CLI, which a fresh clone does not have. These mirror
 * `supabase/migrations/` — when a migration changes a column, change it here in
 * the same commit. Swap the file for generated output once the project is
 * provisioned.
 */

export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type IncidentStatus = 'open' | 'triaged' | 'assigned' | 'resolved'
export type NeedStatus = 'unmet' | 'partial' | 'met' | 'cancelled'
export type ResourceStatus = 'available' | 'committed' | 'depleted' | 'offline'
export type MatchStatus = 'proposed' | 'reserved' | 'committed' | 'released' | 'fulfilled'
export type Availability = 'available' | 'busy' | 'offline'
export type VehicleType = 'bike' | 'car' | 'van' | 'truck' | 'boat' | 'other'

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

export interface ResourceRow {
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
}

export interface NeedRow {
  id: string
  incident_id: string
  kind: string
  quantity: number | null
  unit: string | null
  note: string | null
  status: NeedStatus
  created_at: string
}

export interface MatchRow {
  id: string
  need_id: string
  resource_id: string
  score: number
  allocated_quantity: number | null
  distance_km: number | null
  rationale: Record<string, unknown>
  status: MatchStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

/** A match as it comes back joined to its need, incident and resource. */
export interface PlanMatchRow {
  id: string
  need_id: string
  resource_id: string
  score: number
  allocated_quantity: number | null
  distance_km: number | null
  rationale: { needPriority?: number; terms?: unknown[] } | null
  status: MatchStatus
  needs?: unknown
  resources?: unknown
}

export interface ResponsePlanRow {
  id: string
  label: string | null
  status: 'proposed' | 'approved' | 'discarded'
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
