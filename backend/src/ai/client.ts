import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'

/** Whether model-backed extraction is available at all. */
export const isModelConfigured = Boolean(config.ANTHROPIC_API_KEY)

/**
 * Constructed only when a key exists. The SDK would otherwise throw at import,
 * which would take down the very fallback path meant to cover its absence.
 */
export const anthropic = config.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })
  : null

/**
 * Single place to change the model for every AI call in the app.
 *
 * Opus 5 is the default. Extraction is a short, structured task, so
 * `claude-sonnet-5` costs roughly 60% less per report and also supports the
 * effort parameter this codebase uses — a deliberate tradeoff to make, not one
 * to make silently.
 */
export const MODEL = 'claude-opus-5'
