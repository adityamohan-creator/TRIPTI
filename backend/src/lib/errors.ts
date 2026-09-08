/**
 * A deliberate, client-safe failure.
 *
 * Anything thrown that is *not* an AppError is treated as a bug: the detail goes
 * to the log and the caller gets a generic 500. An AppError is the opposite —
 * its message was written to be read by a user, so the handler passes it
 * through with the status attached.
 */
export class AppError extends Error {
  readonly status: number
  readonly code: string | undefined

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
  }
}

export const badRequest = (message = 'Invalid request') => new AppError(400, message)
export const unauthorized = (message = 'Not authenticated') => new AppError(401, message)
export const forbidden = (message = 'Insufficient permissions') => new AppError(403, message)
export const notFound = (message = 'Not found') => new AppError(404, message)
export const conflict = (message = 'Conflict') => new AppError(409, message)
