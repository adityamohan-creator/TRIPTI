import { Router } from 'express'
import { z } from 'zod'
import { uuidParam } from '../lib/params.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import * as service from '../services/missions.service.js'

export const missionsRouter = Router()

missionsRouter.use(requireAuth)

const ListQuery = z.object({
  status: z
    .enum(['proposed', 'accepted', 'en_route', 'delivered', 'failed', 'cancelled'])
    .optional(),
})

missionsRouter.get('/', async (req, res, next) => {
  try {
    const parsed = ListQuery.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters' })
      return
    }
    res.json(await service.listMissions(req.user!, parsed.data.status))
  } catch (err) {
    next(err)
  }
})

missionsRouter.get('/:id', async (req, res, next) => {
  try {
    res.json(await service.getMission(req.user!, uuidParam(req)))
  } catch (err) {
    next(err)
  }
})

/** Ranked suggestions with their reasoning. Assigns nobody. */
missionsRouter.get(
  '/:id/candidates',
  requireRole('coordinator', 'admin'),
  async (req, res, next) => {
    try {
      res.json(await service.assignmentCandidates(req.user!, uuidParam(req)))
    } catch (err) {
      next(err)
    }
  },
)

const Assign = z.object({
  volunteer_id: z.uuid(),
  vehicle_id: z.uuid().nullish(),
})

missionsRouter.post(
  '/:id/assign',
  requireRole('coordinator', 'admin'),
  async (req, res, next) => {
    try {
      const parsed = Assign.safeParse(req.body)
      if (!parsed.success) {
        res.status(400).json({ error: 'Invalid assignment payload' })
        return
      }
      res.json(
        await service.assignVolunteer(
          req.user!,
          uuidParam(req),
          parsed.data.volunteer_id,
          parsed.data.vehicle_id ?? null,
        ),
      )
    } catch (err) {
      next(err)
    }
  },
)

missionsRouter.post(
  '/:id/route',
  requireRole('coordinator', 'admin'),
  async (req, res, next) => {
    try {
      res.json(await service.buildRoute(req.user!, uuidParam(req)))
    } catch (err) {
      next(err)
    }
  },
)
