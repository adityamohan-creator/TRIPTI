import { z } from 'zod'

/**
 * What a model is allowed to return from a free-text report. Deliberately
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
  /**
   * Whether the report mentions people who are harder to evacuate or more
   * likely to be harmed by delay — children, elderly, disabled, pregnant,
   * injured. Feeds the vulnerability term of the priority score.
   */
  vulnerable_groups: z.array(z.string()),
  source_language: z.string().describe('BCP-47 tag of the original report, e.g. "hi".'),
  confidence: z.number().min(0).max(1),
  unclear: z
    .array(z.string())
    .describe('Anything ambiguous a human coordinator should confirm.'),
})

export type ExtractedIncident = z.infer<typeof ExtractedIncident>

/** How an extraction was produced, so the UI can be honest about it. */
export type ExtractionSource = 'model' | 'fallback'

export interface ExtractionResult {
  extraction: ExtractedIncident
  source: ExtractionSource
  /** Which provider ran, or why the fallback did. */
  provider: string
  /** Present only when the model failed and the fallback took over. */
  degradedReason?: string
}

/**
 * Every extraction backend implements this. The application depends on the
 * interface, never on a vendor SDK — swapping providers, or adding a second one
 * for a different language, should not reach past this file.
 */
export interface ExtractionProvider {
  readonly name: string
  extract(reportText: string): Promise<ExtractedIncident>
}
