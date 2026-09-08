import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import { config } from './config.js'
import { incidentsRouter } from './routes/incidents.js'
import { matchRouter } from './routes/match.js'

export function createApp() {
  const app = express()

  app.use(express.json({ limit: '1mb' }))
  app.use(
    cors({
      origin: config.CORS_ORIGINS,
      credentials: true,
    }),
  )

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, env: config.NODE_ENV })
  })

  app.use('/api/incidents', incidentsRouter)
  app.use('/api/match', matchRouter)

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  // Central error handler. Never leaks internals to the client — the detail goes
  // to the server log and the caller gets a generic message.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err)
    if (res.headersSent) return
    res.status(500).json({ error: 'Internal server error' })
  })

  return app
}
