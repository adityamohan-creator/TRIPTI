import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Spinner } from '../../components/ui/Spinner'
import { EmptyState } from '../../components/ui/States'
import type { Role } from '../../types/api'
import { useAuth } from './auth-context'

function FullPageSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center" role="status">
      <Spinner className="size-6 text-brand-500" />
      <span className="sr-only">Checking your session</span>
    </div>
  )
}

/** Requires a session. Anything else is sent to sign-in, remembering where. */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, initialising } = useAuth()
  const location = useLocation()

  if (initialising) return <FullPageSpinner />
  if (!session) {
    // `state.from` lets sign-in return the user to the page they asked for.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}

/**
 * Requires a session *and* one of the listed roles.
 *
 * This is a usability guard, not a security one: it stops a volunteer from
 * navigating into a coordinator screen and seeing broken empty panels. The
 * actual enforcement is `requireRole` on the backend and RLS in the database,
 * both of which run regardless of what the browser decides to render.
 */
export function RoleRoute({
  allow,
  children,
}: {
  allow: readonly Role[]
  children: ReactNode
}) {
  const { session, profile, initialising, profileError } = useAuth()
  const location = useLocation()

  if (initialising) return <FullPageSpinner />
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  // A signed-in user whose role could not be loaded gets no role-gated screen.
  // Failing closed is the only safe direction here.
  if (!profile) {
    return (
      <EmptyState
        title="Your role could not be confirmed"
        description={
          profileError ??
          'We could not load your profile, so this screen stays locked. Try reloading.'
        }
      />
    )
  }

  if (!allow.includes(profile.role)) {
    return (
      <EmptyState
        title="You do not have access to this screen"
        description={`This area is for ${allow.join(', ')}. Your account is a ${profile.role}.`}
      />
    )
  }

  return <>{children}</>
}
