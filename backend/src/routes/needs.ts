import { Router } from 'express'
import { z } from 'zod'
import { notFound } from '../lib/errors.js'
import { recordStatusChange } from '../lib/history.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { RESOURCE_KINDS } from '../types/db.js'
import { admin } from '../supabase.js'

export const needsRouter = Router()

needsRouter.use(requireAuth)

const COLUMNS = 'id, incident_id, kind, quantity, unit, note, status, created_at'

const ListNeeds = z.object({
  incident_id: z.uuid().optional(),
  status: z.enum(['unmet', 'partial', 'met', 'cancelled']).optional(),
  kind: z.enum(RESOURCE_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})

needsRouter.get('/', async (req, res, next) => {
  try {
    const parsed = ListNeeds.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters' })
      return
    }
    const { incident_id, status, kind, limit } = parsed.data

    let query = admin
      .from('needs')
      .select(`${COLUMNS}, incidents(summary, severity, location_text, lat, lon)`)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (incident_id) query = query.eq('incident_id', incident_id)
    if (status) query = query.eq('status', status)
    if (kind) query = query.eq('kind', kind)

    const { data, error } = await query
    if (error) throw error
    res.json({ needs: data })
  } catch (err) {
    next(err)
  }
})

const CreateNeed = z.object({
  incident_id: z.uuid(),
  kind: z.enum(RESOURCE_KINDS),
  quantity: z.number().nonnegative().nullish(),
  unit: z.string().max(32).nullish(),
  note: z.string().max(1000).nullish(),
})

/**
 * Needs normally arrive from AI extraction. This route is the human path: a
 * coordinator adding what the report did not say, or correcting what it did.
 */
needsRouter.post('/', requireRole('coordinator', 'admin'), async (req, res, next) => {
  try {
    const parsed = CreateNeed.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid need payload' })
      return
    }

    const { data, error } = await admin
      .from('needs')
      .insert({ ...parsed.data, status: 'unmet' })
      .select(COLUMNS)
      .single()

    if (error) throw error

    await recordStatusChange({
      entityType: 'need',
      entityId: data.id,
      fromStatus: null,
      toStatus: 'unmet',
      changedBy: req.user!.id,
      note: 'Added by coordinator',
    })

    res.status(201).json({ need: data })
  } catch (err) {
    next(err)
  }
})

const UpdateNeed = z.object({
  quantity: z.number().nonnegative().nullish(),
  unit: z.string().max(32).nullish(),
  note: z.string().max(1000).nullish(),
  status: z.enum(['unmet', 'partial', 'met', 'cancelled']).optional(),
})

needsRouter.patch('/:id', requireRole('coordinator', 'admin'), async (req, res, next) => {
  try {
    const parsed = UpdateNeed.safeParse(req.body)
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: 'Invalid need payload' })
      return
    }

    const { data: before, error: beforeError } = await admin
      .from('needs')
      .select('status')
      .eq('id', req.params.id)
      .maybeSingle()

    if (beforeError) throw beforeError
    if (!before) throw notFound('No such need')

    const { data, error } = await admin
      .from('needs')
      .update(parsed.data)
      .eq('id', req.params.id)
      .select(COLUMNS)
      .single()

    if (error) throw error

    if (parsed.data.status && parsed.data.status !== before.status) {
      await recordStatusChange({
        entityType: 'need',
        entityId: data.id,
        fromStatus: before.status,
        toStatus: parsed.data.status,
        changedBy: req.user!.id,
      })
    }

    res.json({ need: data })
  } catch (err) {
    next(err)
  }
})
