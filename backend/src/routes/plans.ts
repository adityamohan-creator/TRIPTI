import { Router } from 'express'
import { z } from 'zod'
import { requireAuth, requireRole } from '../middleware/auth.js'
import * as service from '../services/plans.service.js'

export const plansRouter = Router()

// Planning is a coordinator's job end to end — proposing, approving and
// discarding all move real stock, so none of it is open to other roles.
plansRouter.use(requireAuth, requireRole('coordinator', 'admin'))

/**
 * A scored proposal, computed fresh and written nowhere.
 *
 * Deliberately read-only: looking at what the engine would do must not reserve
 * anything, or opening the screen would quietly shrink the pool for everyone
 * else.
 */
plansRouter.get('/preview', async (_req, res, next) => {
  try {
    res.json(await service.previewPlan())
  } catch (err) {
    next(err)
  }
})

const CreatePlan = z.object({
  label: z.string().max(160).nullish(),
  note: z.string().max(1000).nullish(),
})

/** Commits the proposal: reserves the stock and stores what was reserved. */
plansRouter.post('/', async (req, res, next) => {
  try {
    const parsed = CreatePlan.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid plan payload' })
      return
    }
    res.status(201).json(await service.createPlan(req.user!, parsed.data))
  } catch (err) {
    next(err)
  }
})

const ListQuery = z.object({
  status: z.enum(['proposed', 'approved', 'discarded']).optional(),
})

plansRouter.get('/', async (req, res, next) => {
  try {
    const parsed = ListQuery.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters' })
      return
    }
    res.json(await service.listPlans(req.user!, parsed.data.status))
  } catch (err) {
    next(err)
  }
})

plansRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await service.getPlan(req.user!, req.params.id))
  } catch (err) {
    next(err)
  }
})

const Decision = z.object({ note: z.string().max(1000).nullish() })

plansRouter.post('/:id/approve', async (req, res, next) => {
  try {
    const parsed = Decision.safeParse(req.body ?? {})
    res.json(
      await service.approvePlan(
        req.user!,
        req.params.id,
        parsed.success ? parsed.data.note : null,
      ),
    )
  } catch (err) {
    next(err)
  }
})

plansRouter.post('/:id/discard', async (req, res, next) => {
  try {
    const parsed = Decision.safeParse(req.body ?? {})
    res.json(
      await service.discardPlan(
        req.user!,
        req.params.id,
        parsed.success ? parsed.data.note : null,
      ),
    )
  } catch (err) {
    next(err)
  }
})
