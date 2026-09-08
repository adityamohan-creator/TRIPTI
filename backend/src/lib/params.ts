import type { Request } from 'express'
import { z } from 'zod'
import { badRequest } from './errors.js'

/**
 * Reads a route parameter as a string.
 *
 * Express 5 types params on multi-segment routes as `string | string[] |
 * undefined`, which is honest — a caller can send `?id=a&id=b`. Casting it away
 * would push a malformed value straight into a database query, so this narrows
 * by checking rather than by assertion.
 */
export function param(req: Request, name: string): string {
  const value = req.params[name]
  if (typeof value !== 'string' || value.length === 0) {
    throw badRequest(`Missing ${name} in the request path`)
  }
  return value
}

/** The same, for the common case where the parameter must be a UUID. */
export function uuidParam(req: Request, name = 'id'): string {
  const value = param(req, name)
  if (!z.uuid().safeParse(value).success) {
    throw badRequest(`${name} is not a valid identifier`)
  }
  return value
}
