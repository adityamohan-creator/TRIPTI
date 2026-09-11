import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import * as service from '../services/impact.service.js'

export const impactRouter = Router()

impactRouter.use(requireAuth)

const Query = z.object({
  // A year is the longest window worth drawing on one chart, and the cap keeps
  // an arbitrary caller from asking for a decade of daily buckets.
  days: z.coerce.number().int().min(1).max(365).optional(),
})

/** Roles that may see how much slack the response currently has. */
const OPERATIONAL = new Set(['coordinator', 'admin', 'ngo'])

impactRouter.get('/', async (req, res, next) => {
  try {
    const parsed = Query.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters' })
      return
    }

    res.json(
      await service.getImpact({
        days: parsed.data.days,
        includeUtilisation: OPERATIONAL.has(req.user!.role),
      }),
    )
  } catch (err) {
    next(err)
  }
})
