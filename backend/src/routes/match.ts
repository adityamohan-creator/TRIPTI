import { Router } from 'express'
import { type Need, type Resource, matchNeeds } from '../engine/match.js'
import { LIFE_CRITICAL_KINDS } from '../lib/needPriority.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { admin } from '../supabase.js'

export const matchRouter = Router()

matchRouter.use(requireAuth, requireRole('coordinator', 'admin'))

interface IncidentContext {
  lat: number | null
  lon: number | null
  severity: 'low' | 'medium' | 'high' | 'critical'
  people_affected: number | null
  created_at: string
}

/**
 * Supabase types an embedded to-one relation as an array even though it comes
 * back as a single object. Without generated database types there is nothing
 * better to narrow against, so normalize both shapes here.
 */
function oneRelation(value: unknown): IncidentContext | null {
  const row = Array.isArray(value) ? value[0] : value
  return (row as IncidentContext | undefined) ?? null
}

/**
 * Proposes need-to-resource pairings. Read-only on purpose: it returns a plan for
 * a coordinator to approve, and creating missions is a separate explicit action.
 */
matchRouter.post('/preview', async (_req, res, next) => {
  try {
    const [needsResult, resourcesResult] = await Promise.all([
      admin
        .from('needs')
        .select('id, incident_id, kind, quantity, status, incidents(lat, lon, severity, people_affected, created_at)')
        .eq('status', 'unmet'),
      admin.from('resources').select('id, kind, quantity, lat, lon').eq('status', 'available'),
    ])

    if (needsResult.error) throw needsResult.error
    if (resourcesResult.error) throw resourcesResult.error

    const now = Date.now()

    // Needs without coordinates can't be ranked by distance, so they're excluded
    // from the automated plan and surfaced separately for manual handling.
    const withCoords: Need[] = []
    const missingCoords: string[] = []

    for (const row of needsResult.data ?? []) {
      const incident = oneRelation(row.incidents)

      if (incident?.lat == null || incident.lon == null) {
        missingCoords.push(row.id)
        continue
      }

      withCoords.push({
        id: row.id,
        incidentId: row.incident_id,
        kind: row.kind,
        quantity: row.quantity,
        at: { lat: incident.lat, lon: incident.lon },
        severity: incident.severity,
        peopleAffected: incident.people_affected,
        ageMinutes: (now - new Date(incident.created_at).getTime()) / 60_000,
        lifeCritical: LIFE_CRITICAL_KINDS.has(row.kind),
        unmet: true,
      })
    }

    const resources: Resource[] = (resourcesResult.data ?? [])
      .filter((r) => r.lat !== null && r.lon !== null)
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        quantity: r.quantity,
        at: { lat: r.lat, lon: r.lon },
      }))

    res.json({
      matches: matchNeeds(withCoords, resources),
      needsMissingCoordinates: missingCoords,
    })
  } catch (err) {
    next(err)
  }
})
