/**
 * Shown when the browser has no Supabase credentials. This used to be a thrown
 * error at import scope, which rendered a blank white page — the least useful
 * possible response to a missing config value on a fresh clone.
 */
export function ConfigurationError() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-6">
      <div className="max-w-lg">
        <span className="grid size-9 place-items-center rounded-control bg-brand-600 text-sm font-bold text-white">
          T
        </span>
        <h1 className="mt-5 text-xl font-semibold tracking-tight text-ink">
          TRIPTI is not configured yet
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          The browser has no usable Supabase credentials, so sign-in cannot work.
          Either{' '}
          <code className="rounded bg-sunken px-1 py-0.5 font-mono text-xs">
            frontend/.env.local
          </code>{' '}
          does not exist, or it still holds the placeholders copied from{' '}
          <code className="rounded bg-sunken px-1 py-0.5 font-mono text-xs">
            .env.example
          </code>
          . Replace both with your real project values:
        </p>

        <pre className="mt-4 overflow-x-auto rounded-control border border-line bg-sunken p-4 font-mono text-xs text-ink-2">
{`VITE_SUPABASE_URL=https://<your-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable key>`}
        </pre>

        <p className="mt-4 text-sm text-ink-2">
          Then restart the dev server — Vite does not hot-reload environment changes.
          The service role key belongs in{' '}
          <code className="rounded bg-sunken px-1 py-0.5 font-mono text-xs">
            backend/.env
          </code>
          , never here.
        </p>
      </div>
    </div>
  )
}
