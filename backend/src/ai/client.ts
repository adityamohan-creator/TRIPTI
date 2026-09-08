import Anthropic from '@anthropic-ai/sdk'
import { config } from '../config.js'

export const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })

/** Single place to change the model for every AI call in the app. */
export const MODEL = 'claude-opus-5'
