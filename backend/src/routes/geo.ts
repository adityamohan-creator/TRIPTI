import { Router } from 'express'
import { z } from 'zod'
import { geocode } from '../integrations/geocoding.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { geoLimiter } from '../middleware/rateLimit.js'

export const geoRouter = Router()

/**
 * Place name to coordinate *candidates*.
 *
 * Deliberately does not write anything. Coordinates are never inferred in this
 * system: a coordinator picks from these and applies the choice through the
 * incident's own PATCH, so a wrong guess is caught by a person before a truck
 * is sent to it.
 */
geoRouter.get(
  '/',
  requireAuth,
  requireRole('coordinator', 'admin'),
  geoLimiter,
  async (req, res, next) => {
    try {
      const parsed = z
        .object({ q: z.string().min(3).max(200), limit: z.coerce.number().int().min(1).max(10).default(5) })
        .safeParse(req.query)

      if (!parsed.success) {
        res.status(400).json({ error: 'Provide a place name of at least three characters' })
        return
      }

      res.json(await geocode(parsed.data.q, parsed.data.limit))
    } catch (err) {
      next(err)
    }
  },
)
