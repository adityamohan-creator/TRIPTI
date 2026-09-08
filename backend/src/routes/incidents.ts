import { Router } from 'express'
import { z } from 'zod'
import { extractIncident } from '../ai/extractIncident.js'
import { notFound } from '../lib/errors.js'
import { readHistory, recordStatusChange } from '../lib/history.js'
import { needPriority } from '../lib/needPriority.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { aiLimiter } from '../middleware/rateLimit.js'
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

    // A citizen sees the reports they filed. Everyone operational sees the
    // whole board. This mirrors the RLS policy on the table, because the
    // service-role client bypasses RLS and would otherwise return everything.
    if (req.user!.role === 'citizen' || req.user!.role === 'donor') {
      query = query.eq('reported_by', req.user!.id)
    }

    const { data, error } = await query
    if (error) throw error
    res.json({ incidents: data })
  } catch (err) {
    next(err)
  }
})

const CreateIncident = z
  .object({
    report_text: z.string().min(10).max(10_000),
    reporter_phone: z.string().max(32).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
  })
  // A latitude without a longitude is not a partial location, it is a broken
  // one — and a half-located incident is silently dropped by the matcher.
  .refine((v) => (v.lat === undefined) === (v.lon === undefined), {
    message: 'lat and lon must be provided together',
  })

/**
 * Free-text intake. The AI extraction is stored alongside the raw report and the
 * incident opens as 'open' — a coordinator triages it before anything dispatches.
 *
 * Rate limited separately from the rest of the router: this is the one route
 * that spends money on every call.
 */
incidentsRouter.post('/', aiLimiter, async (req, res, next) => {
  try {
    const parsed = CreateIncident.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid incident payload' })
      return
    }
    const body = parsed.data

    const { extraction, source, provider, degradedReason } = await extractIncident(
      body.report_text,
    )

    const { data, error } = await admin
      .from('incidents')
      .insert({
        report_text: body.report_text,
        reported_by: req.user!.id,
        lat: body.lat ?? null,
        lon: body.lon ?? null,
        status: 'open',
        category: extraction.category,
        severity: extraction.severity,
        summary: extraction.summary,
        location_text: extraction.location_text,
        people_affected: extraction.people_affected,
        source_language: extraction.source_language,
        ai_confidence: extraction.confidence,
        ai_unclear: extraction.unclear,
        vulnerable_groups: extraction.vulnerable_groups,
        ai_source: source,
        ai_provider: provider,
        ai_degraded_reason: degradedReason ?? null,
      })
      .select()
      .single()

    if (error) throw error

    // Contact details live in their own backend-only table so they never reach
    // the browser through a table read or a realtime payload.
    if (body.reporter_phone) {
      const { error: contactError } = await admin
        .from('incident_contacts')
        .insert({ incident_id: data.id, reporter_phone: body.reporter_phone })
      if (contactError) throw contactError
    }

    if (extraction.needs.length > 0) {
      const { error: needsError } = await admin.from('needs').insert(
        extraction.needs.map((n) => ({
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

    await recordStatusChange({
      entityType: 'incident',
      entityId: data.id,
      fromStatus: null,
      toStatus: 'open',
      changedBy: req.user!.id,
      note:
        source === 'model'
          ? `Reported. AI confidence ${extraction.confidence.toFixed(2)}.`
          : `Reported. AI extraction unavailable (${degradedReason ?? 'unknown'}); keyword scan only.`,
    })

    res.status(201).json({ incident: data, extraction, source, degradedReason })
  } catch (err) {
    next(err)
  }
})

incidentsRouter.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await admin
      .from('incidents')
      .select('*, needs(*)')
      .eq('id', req.params.id)
      .maybeSingle()

    if (error) throw error
    if (!data) throw notFound('No such incident')

    const isOwner = data.reported_by === req.user!.id
    const isResponder = ['volunteer', 'ngo', 'coordinator', 'admin'].includes(
      req.user!.role,
    )
    // The service-role client bypasses RLS, so the check the database would have
    // made has to be made here instead.
    if (!isOwner && !isResponder) throw notFound('No such incident')

    // The priority of each need, with the per-term arithmetic behind it. A
    // coordinator overriding a score has to be able to see what produced it.
    const needs = (data.needs ?? []) as { id: string; kind: string; status: string; quantity: number | null }[]
    const priorities = Object.fromEntries(
      needs.map((need) => [need.id, needPriority(data, need)]),
    )

    res.json({
      incident: data,
      priorities,
      history: await readHistory('incident', data.id),
    })
  } catch (err) {
    next(err)
  }
})

const Triage = z
  .object({
    severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    status: z.enum(['open', 'triaged', 'assigned', 'resolved']).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lon: z.number().min(-180).max(180).optional(),
    note: z.string().max(500).optional(),
  })
  .refine((v) => (v.lat === undefined) === (v.lon === undefined), {
    message: 'lat and lon must be provided together',
  })

/** Human override of the AI's classification. Coordinators and admins only. */
incidentsRouter.patch(
  '/:id',
  requireRole('coordinator', 'admin'),
  async (req, res, next) => {
    try {
      const parsed = Triage.safeParse(req.body)
      const { note, ...fields } = parsed.success ? parsed.data : { note: undefined }
      if (!parsed.success || Object.keys(fields).length === 0) {
        res.status(400).json({ error: 'Invalid triage payload' })
        return
      }

      const { data: before, error: beforeError } = await admin
        .from('incidents')
        .select('status')
        .eq('id', req.params.id)
        .maybeSingle()

      if (beforeError) throw beforeError
      if (!before) throw notFound('No such incident')

      const { data, error } = await admin
        .from('incidents')
        .update({ ...fields, triaged_by: req.user!.id })
        .eq('id', req.params.id)
        .select()
        .single()

      if (error) throw error

      if (fields.status && fields.status !== before.status) {
        await recordStatusChange({
          entityType: 'incident',
          entityId: data.id,
          fromStatus: before.status,
          toStatus: fields.status,
          changedBy: req.user!.id,
          note: note ?? null,
        })
      }

      res.json({ incident: data })
    } catch (err) {
      next(err)
    }
  },
)
