import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { MODEL, anthropic } from './client.js'

/**
 * What the model is allowed to return from a free-text report. Deliberately
 * descriptive, not prescriptive: it extracts and classifies, it does not decide
 * who gets dispatched. Allocation stays in the deterministic matching engine.
 */
export const ExtractedIncident = z.object({
  summary: z.string().describe('One or two sentences, in English.'),
  category: z.enum([
    'flood',
    'earthquake',
    'fire',
    'cyclone',
    'landslide',
    'medical',
    'displacement',
    'infrastructure',
    'other',
  ]),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  location_text: z
    .string()
    .nullable()
    .describe('Place name exactly as stated in the report. Do not guess coordinates.'),
  people_affected: z.number().int().nonnegative().nullable(),
  needs: z.array(
    z.object({
      kind: z.enum([
        'water',
        'food',
        'shelter',
        'medical',
        'rescue',
        'evacuation',
        'clothing',
        'sanitation',
        'power',
        'other',
      ]),
      quantity: z.number().nonnegative().nullable(),
      unit: z.string().nullable(),
      note: z.string().nullable(),
    }),
  ),
  source_language: z.string().describe('BCP-47 tag of the original report, e.g. "hi".'),
  confidence: z.number().min(0).max(1),
  unclear: z
    .array(z.string())
    .describe('Anything ambiguous a human coordinator should confirm.'),
})

export type ExtractedIncident = z.infer<typeof ExtractedIncident>

const SYSTEM = `You extract structured disaster-response data from incident reports.

Reports arrive in any language, often from distressed people, and are frequently
incomplete or contradictory. Your job is extraction and classification only.

Rules:
- Never invent details. If a field is not stated, use null or an empty array.
- Never geocode. Copy the place name as written into location_text.
- Set severity on stated impact, not on emotional intensity.
- Put every ambiguity into "unclear" instead of resolving it yourself.
- You do not decide who responds or how resources are allocated.`

/**
 * Turns a free-text report into structured fields. The result is a proposal for
 * a human coordinator to confirm, not an authoritative record.
 */
export async function extractIncident(reportText: string): Promise<ExtractedIncident> {
  const message = await anthropic.messages.parse({
    model: MODEL,
    max_tokens: 4096,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { format: zodOutputFormat(ExtractedIncident), effort: 'medium' },
    messages: [{ role: 'user', content: `Incident report:\n\n${reportText}` }],
  })

  if (message.stop_reason === 'refusal') {
    throw new Error(
      `Extraction declined: ${message.stop_details?.category ?? 'unknown category'}`,
    )
  }
  if (!message.parsed_output) {
    throw new Error('Extraction returned no parseable output')
  }
  return message.parsed_output
}
