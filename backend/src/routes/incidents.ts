import { Router } from 'express'
import { z } from 'zod'
import { extractIncident } from '../ai/extractIncident.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { admin } from '../supabase.js'

export const incidentsRouter = Router()

incidentsRouter.use(requireAuth)

const ListQuery = z.object({
  status: z.enum(['open', 'triaged', 'assigned', 'resolved']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

incidentsRouter.get('/', async (req, res, next) => {
  try {
    const parsed = ListQuery.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters' })
      return
    }
    const { status, limit } = parsed.data

    let query = admin
      .from('incidents')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit)
    if (status) query = query.eq('status', status)

    const { data, error } = await query
    if (error) throw error
    res.json({ incidents: data })
  } catch (err) {
    next(err)
  }
})

const CreateIncident = z.object({
  report_text: z.string().min(10).max(10_000),
  reporter_phone: z.string().max(32).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
})

/**
 * Free-text intake. The AI extraction is stored alongside the raw report and the
 * incident opens as 'open' — a coordinator triages it before anything dispatches.
 */
incidentsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = CreateIncident.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid incident payload' })
      return
    }
    const body = parsed.data

    const extracted = await extractIncident(body.report_text)

    const { data, error } = await admin
      .from('incidents')
      .insert({
        report_text: body.report_text,
        reporter_phone: body.reporter_phone ?? null,
        reported_by: req.user!.id,
        lat: body.lat ?? null,
        lon: body.lon ?? null,
        status: 'open',
        category: extracted.category,
        severity: extracted.severity,
        summary: extracted.summary,
        location_text: extracted.location_text,
        people_affected: extracted.people_affected,
        source_language: extracted.source_language,
        ai_confidence: extracted.confidence,
        ai_unclear: extracted.unclear,
      })
      .select()
      .single()

    if (error) throw error

    if (extracted.needs.length > 0) {
      const { error: needsError } = await admin.from('needs').insert(
        extracted.needs.map((n) => ({
          incident_id: data.id,
          kind: n.kind,
          quantity: n.quantity,
          unit: n.unit,
          note: n.note,
          status: 'unmet',
        })),
      )
      if (needsError) throw needsError
    }

    res.status(201).json({ incident: data, extracted })
  } catch (err) {
    next(err)
  }
})

const Triage = z.object({
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  status: z.enum(['open', 'triaged', 'assigned', 'resolved']).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
})

/** Human override of the AI's classification. Coordinators and admins only. */
incidentsRouter.patch(
  '/:id',
  requireRole('coordinator', 'admin'),
  async (req, res, next) => {
    try {
      const parsed = Triage.safeParse(req.body)
      if (!parsed.success || Object.keys(parsed.data).length === 0) {
        res.status(400).json({ error: 'Invalid triage payload' })
        return
      }

      const { data, error } = await admin
        .from('incidents')
        .update({ ...parsed.data, triaged_by: req.user!.id })
        .eq('id', req.params.id)
        .select()
        .single()

      if (error) throw error
      res.json({ incident: data })
    } catch (err) {
      next(err)
    }
  },
)
