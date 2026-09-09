import { Router } from 'express'
import { z } from 'zod'
import { uuidParam } from '../lib/params.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import * as service from '../services/reallocation.service.js'

export const reallocationRouter = Router()

/**
 * Reallocation takes a delivery away from one group of people and gives it to
 * another. Nobody but a coordinator sees it, let alone approves it.
 */
reallocationRouter.use(requireAuth, requireRole('coordinator', 'admin'))

const PreviewQuery = z.object({
  min_gain: z.coerce.number().min(0).max(100).optional(),
  incident_id: z.uuid().optional(),
})

/** What would move. Read-only — opening this commits to nothing. */
reallocationRouter.get('/preview', async (req, res, next) => {
  try {
    const parsed = PreviewQuery.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters' })
      return
    }
    res.json(
      await service.previewReallocation({
        minPriorityGain: parsed.data.min_gain,
        triggeredByIncident: parsed.data.incident_id ?? null,
      }),
    )
  } catch (err) {
    next(err)
  }
})

const Create = z.object({
  min_gain: z.number().min(0).max(100).optional(),
  incident_id: z.uuid().nullish(),
})

reallocationRouter.post('/', async (req, res, next) => {
  try {
    const parsed = Create.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid payload' })
      return
    }
    res.status(201).json(
      await service.createReallocation(req.user!, {
        minPriorityGain: parsed.data.min_gain,
        triggeredByIncident: parsed.data.incident_id ?? null,
      }),
    )
  } catch (err) {
    next(err)
  }
})

reallocationRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await service.listReallocations())
  } catch (err) {
    next(err)
  }
})

reallocationRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await service.getReallocation(uuidParam(req)))
  } catch (err) {
    next(err)
  }
})

const Decision = z.object({ note: z.string().max(1000).nullish() })

reallocationRouter.post('/:id/approve', async (req, res, next) => {
  try {
    const parsed = Decision.safeParse(req.body ?? {})
    res.json(
      await service.approveReallocation(
        req.user!,
        uuidParam(req),
        parsed.success ? parsed.data.note : null,
      ),
    )
  } catch (err) {
    next(err)
  }
})

reallocationRouter.post('/:id/discard', async (req, res, next) => {
  try {
    const parsed = Decision.safeParse(req.body ?? {})
    res.json(
      await service.discardReallocation(
        req.user!,
        uuidParam(req),
        parsed.success ? parsed.data.note : null,
      ),
    )
  } catch (err) {
    next(err)
  }
})
