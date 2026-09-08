import rateLimit from 'express-rate-limit'

/** Broad ceiling so one client cannot exhaust the API for everyone else. */
export const generalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests' },
})

/**
 * Tighter bucket for the handful of routes that call the Anthropic API. Each of
 * those requests costs real money, so an authenticated account should not be
 * able to loop on them. Intake is a human typing a report — a few per minute is
 * plenty, and a coordinator listing incidents is not affected because this is
 * mounted per-route, not per-router.
 */
export const aiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many reports submitted. Wait a moment and try again.' },
})
