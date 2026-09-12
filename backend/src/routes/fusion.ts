import { Router } from 'express'
import { z } from 'zod'
import { uuidParam } from '../lib/params.js'
import { requireAuth, requireRole } from '../middleware/auth.js'
import * as service from '../services/fusion.service.js'

export const fusionRouter = Router()

/*
 * Staff only.
 *
 * A clustering says which reports the system believes describe one incident,
 * and it is read alongside the whole board to make sense of. That is the same
 * operational picture `planning` and `reallocation` are gated on, so it is
 * gated the same way.
 */
fusionRouter.use(requireAuth, requireRole('coordinator', 'admin', 'ngo'))

const RunBody = z.object({
  source: z.enum(['incidents', 'demo']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  /*
   * Exposed so a coordinator can tighten or loosen grouping live. Bounded well
   * inside 0-1: a threshold of 0 puts every report in one cluster and 1 puts
   * each in its own, and neither is a useful answer to hand someone.
   */
  threshold: z.coerce.number().min(0.05).max(0.95).optional(),
  /** Persist the result. Off by default — looking must not commit. */
  save: z.boolean().optional(),
})

/**
 * Runs fusion over a set of reports and returns the clusters.
 *
 * Read-only unless `save` is set. Opening this screen during an incident must
 * not write anything.
 */
fusionRouter.post('/cluster', async (req, res, next) => {
  try {
    const parsed = RunBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid fusion payload' })
      return
    }

    const result = await service.runFusion({
      source: parsed.data.source,
      limit: parsed.data.limit,
      threshold: parsed.data.threshold,
    })

    if (parsed.data.save) {
      const { saved } = await service.saveRun(req.user!, result)
      res.json({ ...result, saved })
      return
    }

    res.json(result)
  } catch (err) {
    next(err)
  }
})

fusionRouter.get('/clusters', async (_req, res, next) => {
  try {
    res.json(await service.listClusters())
  } catch (err) {
    next(err)
  }
})

fusionRouter.get('/clusters/:id', async (req, res, next) => {
  try {
    res.json(await service.getCluster(uuidParam(req)))
  } catch (err) {
    next(err)
  }
})
