import { Navigate, Route, Routes } from 'react-router-dom'
import { EmptyState } from '../components/ui/States'
import { LoginPage } from '../features/auth/LoginPage'
import { ProfilePage } from '../features/auth/ProfilePage'
import { ProtectedRoute } from '../features/auth/ProtectedRoute'
import { RegisterPage } from '../features/auth/RegisterPage'
import { AppShell } from '../layouts/AppShell'
import { AuthLayout } from '../layouts/AuthLayout'
import { Dashboard } from '../pages/Dashboard'
import { Incidents } from '../pages/Incidents'
import { Landing } from '../pages/Landing'
import { Missions } from '../pages/Missions'
import { Resources } from '../pages/Resources'

/**
 * Public routes, then the authenticated shell. Role gating happens per route
 * with <RoleRoute> as screens gain operator-only actions; for now every signed-in
 * role sees the same four screens, filtered by what the backend returns them.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />

      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
      </Route>

      <Route
        path="/app"
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="incidents" element={<Incidents />} />
        <Route path="resources" element={<Resources />} />
        <Route path="missions" element={<Missions />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>

      {/* Old top-level paths from before the /app prefix existed. */}
      <Route path="/dashboard" element={<Navigate to="/app" replace />} />

      <Route
        path="*"
        element={
          <div className="mx-auto max-w-lg px-6 py-24">
            <EmptyState
              title="Page not found"
              description="That address does not match anything in TRIPTI."
            />
          </div>
        }
      />
    </Routes>
  )
}
