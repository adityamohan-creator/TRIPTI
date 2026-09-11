import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  SUPABASE_URL: z.url(),
  // Verifies incoming user JWTs. Safe to expose; it is the browser key.
  SUPABASE_ANON_KEY: z.string().min(1),
  // Bypasses row level security. Server-only — never send this to a client.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  /*
   * Optional on purpose.
   *
   * Without it, extraction falls back to the deterministic keyword scan in
   * ai/fallback.ts — the same path that runs during an API outage. Intake,
   * triage, matching and every screen keep working; reports simply arrive
   * marked as "nothing has read this yet" for a coordinator to read manually.
   *
   * Requiring it would mean a contributor cannot run the project at all until
   * they have added billing to a third-party account, which is a worse failure
   * than degraded extraction.
   */
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  // Comma-separated list of origins allowed to call this API.
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),
})

/*
 * A blank variable means the same as an absent one.
 *
 * Hosting dashboards do not distinguish the two: leaving an optional field
 * empty in Render or Vercel submits "" rather than omitting the key. Without
 * this, ANTHROPIC_API_KEY deliberately left blank — which the setup docs tell
 * people to do — fails `.min(1)`, and `.optional()` does not save it because
 * optional admits `undefined`, not the empty string.
 *
 * The cost of getting this wrong is out of all proportion to the mistake: the
 * process throws here, before the server listens, so the platform reports only
 * a failed health check and the real reason sits in a build log nobody thinks
 * to open. It cost one failed Render deploy to find.
 */
const env = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value == null || value.trim() !== ''),
)

const parsed = schema.safeParse(env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n')
  throw new Error(
    `Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill in the missing values.`,
  )
}

export const config = parsed.data
