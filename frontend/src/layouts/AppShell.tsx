import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { DemoTour } from '../features/tour/DemoTour'
import { Alert } from '../components/ui/Alert'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { useAuth } from '../features/auth/auth-context'
import { cn } from '../lib/cn'
import { ROLE_LABELS, type Role } from '../types/api'

interface NavItem {
  to: string
  label: string
  /** Roles that see this item at all. Omitted means everyone signed in. */
  roles?: readonly Role[]
  end?: boolean
}

/*
 * `roles` hides an item that would open on nothing.
 *
 * The backend already scopes every one of these correctly — a citizen asking
 * for vehicles gets their own, which is none. But the link was still in the
 * nav, so the screen opened empty and read as broken rather than as
 * not-for-you. An empty state is the right answer to "you have none"; it is
 * the wrong answer to "this was never yours".
 *
 * This is presentation only. Removing a link is not access control, and the
 * routes and services stay exactly as authoritative as before.
 */
const RESPONDERS = ['volunteer', 'ngo', 'coordinator', 'admin'] as const
const STAFF = ['coordinator', 'admin'] as const

const NAV: NavItem[] = [
  { to: '/app', label: 'Overview', end: true },
  { to: '/app/map', label: 'Map' },
  { to: '/app/incidents', label: 'Incidents' },
  { to: '/app/resources', label: 'Resources' },
  { to: '/app/planning', label: 'Planning', roles: STAFF },
  { to: '/app/reallocation', label: 'Reallocate', roles: STAFF },
  { to: '/app/missions', label: 'Missions' },
  // The fleet is operational data; a citizen or donor owns no vehicles.
  { to: '/app/vehicles', label: 'Vehicles', roles: RESPONDERS },
  // Availability is a volunteer's own shift record. Nobody else has one to set.
  { to: '/app/availability', label: 'Availability', roles: ['volunteer', 'admin'] },
]

function initials(name: string | null, email: string | undefined): string {
  const source = name?.trim() || email || '?'
  const parts = source.split(/[\s@.]+/).filter(Boolean)
  return (parts[0]?.[0] ?? '?').concat(parts[1]?.[0] ?? '').toUpperCase()
}

export function AppShell() {
  const { profile, session, profileError, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const visible = NAV.filter((item) => !item.roles || (profile && item.roles.includes(profile.role)))

  async function onSignOut() {
    await signOut()
    navigate('/', { replace: true })
  }

  // The active tab is marked by a rule under the header rather than a filled
  // pill — quieter, and it survives being one of five tabs without the header
  // turning into a row of coloured blocks.
  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'relative -mb-px flex h-14 items-center border-b px-1 text-[13px] transition-colors',
      isActive
        ? 'border-ink font-medium text-ink'
        : 'border-transparent text-ink-2 hover:text-ink',
    )

  return (
    <div className="min-h-screen bg-page">
      <header className="sticky top-0 z-30 border-b border-line bg-page/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4">
          <NavLink to="/app" className="flex shrink-0 items-center gap-2">
            <span className="grid size-7 place-items-center rounded-control bg-action text-[11px] font-bold text-action-fg shadow-solid">
              T
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-ink">TRIPTI</span>
          </NavLink>

          <nav aria-label="Main" className="hidden h-14 gap-5 md:flex">
            {visible.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {/*
              Responsive visibility goes on a wrapper, never on the component.
              Badge and Button set `inline-flex` in their own base classes, and
              cn() only concatenates — so `hidden` and `inline-flex` would both
              land on the element, where Tailwind's source order lets
              inline-flex win. The element stays visible and pushes the header
              past the viewport, which is invisible on a desktop screen.
            */}
            {profile && (
              <span className="hidden sm:block">
                <Badge tone="brand">{ROLE_LABELS[profile.role]}</Badge>
              </span>
            )}
            <NavLink
              to="/app/profile"
              aria-label="Your profile"
              className="grid size-7 place-items-center rounded-full border border-line bg-sunken text-[10px] font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
            >
              {initials(profile?.full_name ?? null, session?.user.email)}
            </NavLink>
            <span className="hidden sm:block">
              <Button variant="ghost" size="sm" onClick={onSignOut}>
                Sign out
              </Button>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="md:hidden"
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              onClick={() => setMenuOpen((open) => !open)}
            >
              Menu
            </Button>
          </div>
        </div>

        {menuOpen && (
          <nav
            id="mobile-nav"
            aria-label="Main"
            className="border-t border-line px-4 py-2 md:hidden"
          >
            <div className="flex flex-col gap-1">
              {visible.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={navLinkClass}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </NavLink>
              ))}
              <button
                type="button"
                onClick={onSignOut}
                className="rounded-control px-1 py-2 text-left text-[13px] text-ink-2 hover:text-ink"
              >
                Sign out
              </button>
            </div>
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8">
        {/* Signed in but role unknown — every role-gated screen will be closed,
            so say why once here rather than leaving empty panels unexplained. */}
        {profileError && (
          <Alert tone="warning" title="Running without a confirmed role" className="mb-6">
            {profileError} Some screens will stay locked until this resolves.
          </Alert>
        )}
        <Outlet />
      </main>

      {/*
        Outside <main> and fixed, so it explains whichever screen is open
        without becoming part of any one page's layout.
      */}
      <DemoTour />
    </div>
  )
}
