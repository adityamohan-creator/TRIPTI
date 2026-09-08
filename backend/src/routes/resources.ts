import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { CreateResource, ListResources, UpdateResource } from '../schemas/resources.js'
import * as service from '../services/resources.service.js'

export const resourcesRouter = Router()

resourcesRouter.use(requireAuth)

/**
 * Routes carry HTTP concerns only: parse, delegate, choose a status code.
 * Authorization lives in the service because it is a business rule, not a
 * transport one — and because the service is what the next caller will reuse.
 */

resourcesRouter.get('/', async (req, res, next) => {
  try {
    const parsed = ListResources.safeParse(req.query)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters' })
      return
    }
    res.json(await service.listResources(req.user!, parsed.data))
  } catch (err) {
    next(err)
  }
})

resourcesRouter.get('/:id', async (req, res, next) => {
  try {
    res.json({ resource: await service.getResource(req.user!, req.params.id) })
  } catch (err) {
    next(err)
  }
})

resourcesRouter.post('/', async (req, res, next) => {
  try {
    const parsed = CreateResource.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid resource payload' })
      return
    }
    res.status(201).json({ resource: await service.createResource(req.user!, parsed.data) })
  } catch (err) {
    next(err)
  }
})

resourcesRouter.patch('/:id', async (req, res, next) => {
  try {
    const parsed = UpdateResource.safeParse(req.body)
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: 'Invalid resource payload' })
      return
    }
    const resource = await service.updateResource(req.user!, req.params.id, parsed.data)
    res.json({ resource })
  } catch (err) {
    next(err)
  }
})

resourcesRouter.delete('/:id', async (req, res, next) => {
  try {
    await service.deleteResource(req.user!, req.params.id)
    res.status(204).end()
  } catch (err) {
    next(err)
  }
})
