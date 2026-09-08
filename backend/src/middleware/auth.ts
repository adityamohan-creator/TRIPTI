import type { NextFunction, Request, Response } from 'express'
import { admin, verifyAccessToken } from '../supabase.js'

export const ROLES = ['viewer', 'volunteer', 'donor', 'coordinator', 'admin'] as const
export type Role = (typeof ROLES)[number]

export interface AuthUser {
  id: string
  email: string | undefined
  role: Role
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

/**
 * Verifies the bearer token with Supabase and loads the caller's role from the
 * profiles table. The role always comes from the database, never from the token
 * body or a client-supplied header — a caller must not be able to claim a role.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.get('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null

  if (!token) {
    res.status(401).json({ error: 'Missing bearer token' })
    return
  }

  const user = await verifyAccessToken(token)
  if (!user) {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  const { data: profile, error } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (error) {
    res.status(403).json({ error: 'No profile for this account' })
    return
  }

  req.user = {
    id: user.id,
    email: user.email,
    role: (profile.role ?? 'viewer') as Role,
  }
  next()
}

/** Route guard. Use after requireAuth. */
export function requireRole(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Not authenticated' })
      return
    }
    if (!allowed.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient role' })
      return
    }
    next()
  }
}
