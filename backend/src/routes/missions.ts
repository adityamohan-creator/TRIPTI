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

/** What this caller may do with this mission right now. */
missionsRouter.get('/:id/actions', async (req, res, next) => {
  try {
    res.json(await service.missionActions(req.user!, uuidParam(req)))
  } catch (err) {
    next(err)
  }
})

const Transition = z.object({
  status: z.enum([
    'accepted',
    'en_route',
    'delivered',
    'verified',
    'failed',
    'cancelled',
  ]),
  note: z.string().max(1000).nullish(),
})

/**
 * Moves a mission along.
 *
 * Deliberately not requireRole: a volunteer advances their own run and a
 * coordinator closes it, and which of those you are depends on the mission, not
 * on your role alone. The service decides, using the same state machine the UI
 * reads its buttons from.
 */
missionsRouter.post('/:id/status', async (req, res, next) => {
  try {
    const parsed = Transition.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid status payload' })
      return
    }
    res.json(
      await service.transitionMission(
        req.user!,
        uuidParam(req),
        parsed.data.status,
        parsed.data.note,
      ),
    )
  } catch (err) {
    next(err)
  }
})

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
