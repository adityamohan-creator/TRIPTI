import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { LoginPage } from '../features/auth/LoginPage'
import { ProfilePage } from '../features/auth/ProfilePage'
import { ProtectedRoute, RoleRoute } from '../features/auth/ProtectedRoute'
import { RegisterPage } from '../features/auth/RegisterPage'
import { IncidentDetailPage } from '../features/incidents/IncidentDetailPage'
import { ReportPage } from '../features/incidents/ReportPage'
import { VehiclesPage } from '../features/fleet/VehiclesPage'
import { VolunteerPage } from '../features/fleet/VolunteerPage'
import { MissionsPage } from '../features/missions/MissionsPage'
import { PlanningPage } from '../features/plans/PlanningPage'
import { ReallocationPage } from '../features/reallocation/ReallocationPage'
import { ResourcesPage } from '../features/resources/ResourcesPage'
import { AppShell } from '../layouts/AppShell'
import { AuthLayout } from '../layouts/AuthLayout'
import { Dashboard } from '../pages/Dashboard'
import { Incidents } from '../pages/Incidents'
import { Landing } from '../pages/Landing'
import { NotFound } from '../pages/NotFound'
import { Skeleton } from '../components/ui/Skeleton'

/*
 * Leaflet and its stylesheet are about 160 kB, and only the map screen needs
 * them. Loaded eagerly they were downloaded by every user on every route,
 * including the sign-in page — so the map pays for itself only when someone
 * opens it.
 */
const MapPage = lazy(() =>
  import('../pages/MapPage').then((m) => ({ default: m.MapPage })),
)

/**
 * Public routes, then the authenticated shell. Role gating happens per route
 * with <RoleRoute> as screens gain operator-only actions; for now every signed-in
 * role sees the same screens, filtered by what the backend returns them.
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
        <Route
          path="map"
          element={
            <Suspense fallback={<Skeleton className="h-[28rem] w-full" />}>
              <MapPage />
            </Suspense>
          }
        />
        <Route path="incidents" element={<Incidents />} />
        <Route path="incidents/new" element={<ReportPage />} />
        <Route path="incidents/:id" element={<IncidentDetailPage />} />
        <Route path="resources" element={<ResourcesPage />} />
        <Route
          path="reallocation"
          element={
            <RoleRoute allow={['coordinator', 'admin']}>
              <ReallocationPage />
            </RoleRoute>
          }
        />
        <Route
          path="planning"
          element={
            <RoleRoute allow={['coordinator', 'admin']}>
              <PlanningPage />
            </RoleRoute>
          }
        />
        <Route path="missions" element={<MissionsPage />} />
        {/*
          Gated to match the nav rather than only hidden from it. Hiding a link
          is presentation; typing the URL must land somewhere that explains
          itself instead of on an empty screen that reads as a fault.
        */}
        <Route
          path="availability"
          element={
            <RoleRoute allow={['volunteer', 'admin']}>
              <VolunteerPage />
            </RoleRoute>
          }
        />
        <Route
          path="vehicles"
          element={
            <RoleRoute allow={['volunteer', 'ngo', 'coordinator', 'admin']}>
              <VehiclesPage />
            </RoleRoute>
          }
        />
        <Route path="profile" element={<ProfilePage />} />
      </Route>

      {/*
        These screens lived at the top level before the /app shell existed, so a
        bookmark or a typed URL from that layout landed on "page not found"
        instead of the page it named. Redirect rather than 404 — the address was
        right, it just moved.
      */}
      {['dashboard', 'incidents', 'resources', 'missions', 'profile'].map((path) => (
        <Route
          key={path}
          path={`/${path}`}
          element={<Navigate to={path === 'dashboard' ? '/app' : `/app/${path}`} replace />}
        />
      ))}
      <Route path="/signin" element={<Navigate to="/login" replace />} />
      <Route path="/signup" element={<Navigate to="/register" replace />} />

      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
