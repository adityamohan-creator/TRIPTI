import { Link, useLocation } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { useAuth } from '../features/auth/auth-context'

/**
 * A dead end should tell you where you are and give you a way out. The previous
 * version rendered a bare "Page not found" with no navigation at all, which
 * leaves anyone who mistypes a URL stuck on a blank screen.
 */
export function NotFound() {
  const { session } = useAuth()
  const { pathname } = useLocation()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-ink-3">404</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">
        There is nothing at this address
      </h1>
      <p className="mt-2 max-w-md text-sm text-ink-2">
        <code className="rounded bg-sunken px-1.5 py-0.5 font-mono text-xs">{pathname}</code>{' '}
        does not match any page in TRIPTI.
      </p>

      <div className="mt-7 flex flex-wrap justify-center gap-2">
        <Link to={session ? '/app' : '/'}>
          <Button>{session ? 'Back to the dashboard' : 'Back to the home page'}</Button>
        </Link>
        {!session && (
          <Link to="/login">
            <Button variant="secondary">Sign in</Button>
          </Link>
        )}
      </div>
    </div>
  )
}
