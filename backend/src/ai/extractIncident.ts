import { fallbackExtract } from './fallback.js'
import {
  ExtractedIncident,
  type ExtractionProvider,
  type ExtractionResult,
} from './types.js'

export { ExtractedIncident } from './types.js'
export type { ExtractionResult, ExtractionSource } from './types.js'

/**
 * Resolved on first use, not at import.
 *
 * The Anthropic provider reaches config.ts, which throws at module load when the
 * environment is incomplete. Constructing it eagerly made this whole module —
 * including the fallback path whose entire job is to work when the model does
 * not — impossible to load without a full set of API keys.
 */
async function defaultProvider(): Promise<ExtractionProvider | null> {
  const [{ anthropicProvider }, { isModelConfigured }] = await Promise.all([
    import('./anthropic.provider.js'),
    import('./client.js'),
  ])
  return isModelConfigured ? anthropicProvider : null
}

/** The keyword scan, packaged as a result. */
function degraded(reportText: string, reason: string): ExtractionResult {
  return {
    extraction: fallbackExtract(reportText),
    source: 'fallback',
    provider: 'deterministic-keyword-scan',
    degradedReason: reason,
  }
}

/** A slow extraction is a failed extraction — someone is waiting on this. */
const TIMEOUT_MS = 25_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Extraction timed out after ${ms}ms`)),
      ms,
    )
    promise.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

/**
 * Turns a free-text report into structured fields.
 *
 * The result is a proposal for a human coordinator to confirm, never an
 * authoritative record — which is also why a model failure is not fatal here.
 * If the provider errors, times out, or returns something that does not match
 * the schema, the deterministic keyword fallback runs instead and the result is
 * marked `source: 'fallback'` so every surface downstream can say so plainly.
 *
 * An AI outage degrades intake. It must never block it.
 */
export async function extractIncident(
  reportText: string,
  override?: ExtractionProvider,
): Promise<ExtractionResult> {
  let provider: ExtractionProvider | null = null
  try {
    provider = override ?? (await defaultProvider())

    // No key configured. This is a deliberate operating mode, not a failure, so
    // it degrades quietly rather than logging an error on every report.
    if (!provider) {
      return degraded(reportText, 'No ANTHROPIC_API_KEY configured')
    }

    const raw = await withTimeout(provider.extract(reportText), TIMEOUT_MS)

    // Validate even though the provider claims to have done so. A provider is
    // an interface, and the next implementation may be less careful.
    const parsed = ExtractedIncident.safeParse(raw)
    if (!parsed.success) {
      throw new Error('Extraction did not match the expected schema')
    }

    return { extraction: parsed.data, source: 'model', provider: provider.name }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Unknown extraction failure'
    console.error('AI extraction failed, falling back to keyword scan:', reason)
    return degraded(reportText, reason)
  }
}
