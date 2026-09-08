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

const parsed = schema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n')
  throw new Error(
    `Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env and fill in the missing values.`,
  )
}

export const config = parsed.data
