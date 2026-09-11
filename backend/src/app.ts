import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import helmet from 'helmet'
import { config } from './config.js'
import { AppError } from './lib/errors.js'
import { generalLimiter } from './middleware/rateLimit.js'
import { fleetRouter } from './routes/fleet.js'
import { geoRouter } from './routes/geo.js'
import { impactRouter } from './routes/impact.js'
import { incidentsRouter } from './routes/incidents.js'
import { missionsRouter } from './routes/missions.js'
import { matchRouter } from './routes/match.js'
import { needsRouter } from './routes/needs.js'
import { plansRouter } from './routes/plans.js'
import { reallocationRouter } from './routes/reallocation.js'
import { profileRouter } from './routes/profile.js'
import { resourcesRouter } from './routes/resources.js'

export function createApp() {
  const app = express()

  // Behind Render/Railway/Vercel there is a proxy in front, so req.ip has to come
  // from X-Forwarded-For or every client looks like the same address to the rate
  // limiter. One hop only — trusting the whole chain lets a caller spoof it.
  app.set('trust proxy', 1)

  app.use(helmet())
  app.use(express.json({ limit: '1mb' }))
  app.use(
    cors({
      origin: config.CORS_ORIGINS,
      credentials: true,
    }),
  )

  /**
   * Platform health probe. Deliberately says nothing about the deployment —
   * this endpoint is unauthenticated and reachable from anywhere.
   */
  const health = (_req: Request, res: Response) => {
    res.json({ status: 'ok' })
  }

  app.get('/health', health)
  // Same probe under the /api prefix, so the frontend's dev proxy can reach it.
  app.get('/api/health', health)

  app.use('/api', generalLimiter)

  app.use('/api/profile', profileRouter)
  app.use('/api/incidents', incidentsRouter)
  app.use('/api/needs', needsRouter)
  app.use('/api/resources', resourcesRouter)
  app.use('/api/plans', plansRouter)
  app.use('/api/reallocation', reallocationRouter)
  app.use('/api/missions', missionsRouter)
  app.use('/api/impact', impactRouter)
  app.use('/api/geocode', geoRouter)
  app.use('/api', fleetRouter)
  app.use('/api/match', matchRouter)

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  /**
   * Central error handler. An AppError was written for a user to read, so it
   * passes through with its status. Anything else is a bug: the detail goes to
   * the log and the caller gets a generic message, because internals are not the
   * caller's business.
   */
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return

    if (err instanceof AppError) {
      res.status(err.status).json({ error: err.message, code: err.code })
      return
    }

    console.error('Unhandled error:', err)
    res.status(500).json({ error: 'Internal server error' })
  })

  return app
}
