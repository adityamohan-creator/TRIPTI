import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { feedLimiter } from '../middleware/rateLimit.js'
import * as service from '../services/feed.service.js'

export const feedRouter = Router()

/*
 * Authenticated, though the underlying feed is public.
 *
 * The response says which alerts sit near this deployment's open incidents,
 * and that is operational information about where we are working — not
 * something to hand to anyone who finds the URL.
 */
feedRouter.use(requireAuth)

feedRouter.get('/', feedLimiter, async (_req, res, next) => {
  try {
    res.json(await service.getFeedWithContext())
  } catch (err) {
    next(err)
  }
})
