import { Router } from 'express'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { previewPlan } from '../services/matching.service.js'

export const matchRouter = Router()

matchRouter.use(requireAuth, requireRole('coordinator', 'admin'))

/**
 * Kept for the original path. The scoring, the loader and the read-only
 * guarantee all live in the plans service now — two code paths producing "the
 * plan" is exactly how the two drift apart.
 */
matchRouter.post('/preview', async (_req, res, next) => {
  try {
    res.json(await previewPlan())
  } catch (err) {
    next(err)
  }
})
