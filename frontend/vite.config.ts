import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

/** Without these the bundle cannot reach Supabase, so it cannot do anything. */
const REQUIRED_BUILD_ENV = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  /*
   * Fail the build when the environment is incomplete.
   *
   * This is not defensive tidiness — it prevents a silent, shipped-to-production
   * failure. Vite substitutes `import.meta.env.VITE_*` with literals at build
   * time, so with the variables unset `isSupabaseConfigured` folds to a constant
   * `false`, and the bundler then eliminates the entire application behind that
   * branch as dead code. The build stays green and emits a bundle whose only
   * possible render is the "not configured" screen. Setting the variables on the
   * hosting platform afterwards cannot fix it, because the code is gone.
   *
   * Dev is left alone: there the friendly setup screen is exactly right, and
   * nothing is being shipped.
   */
  if (command === 'build') {
    // A placeholder counts as missing. Copying .env.example and forgetting to
    // edit it otherwise produces a bundle pinned to a hostname that does not
    // resolve — which fails at runtime for every user, not at build time.
    const placeholder = /your-project|your-anon-key|placeholder|paste_/i
    const missing = REQUIRED_BUILD_ENV.filter(
      (key) => !env[key] || placeholder.test(env[key]),
    )
    if (missing.length > 0) {
      throw new Error(
        `Cannot build the frontend: ${missing.join(' and ')} unset, or still ` +
          'holding the placeholder from .env.example.\n' +
          'These are inlined into the bundle at build time, so a build without ' +
          'real values produces an app that can only ever show the setup screen ' +
          'or fail against a hostname that does not resolve.\n' +
          'Fill in .env.local with your project values, or set them in your ' +
          'CI/hosting environment. Both are public — the service role key does ' +
          'not belong here.',
      )
    }
  }

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        // Backend API during local dev. Keeps the browser on one origin,
        // so no CORS preflight and cookies stay first-party.
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true,
        },
      },
    },
  }
})
