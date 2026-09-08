import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
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

const NAV: NavItem[] = [
  { to: '/app', label: 'Overview', end: true },
  { to: '/app/incidents', label: 'Incidents' },
  { to: '/app/resources', label: 'Resources' },
  { to: '/app/missions', label: 'Missions' },
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

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    cn(
      'rounded-control px-3 py-2 text-sm font-medium transition-colors',
      isActive ? 'bg-brand-600 text-white' : 'text-ink-2 hover:bg-sunken hover:text-ink',
    )

  return (
    <div className="min-h-screen bg-page">
      <header className="sticky top-0 z-30 border-b border-line bg-raised/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <NavLink to="/app" className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-control bg-brand-600 text-sm font-bold text-white">
              T
            </span>
            <span className="text-base font-semibold tracking-tight text-ink">TRIPTI</span>
          </NavLink>

          <nav aria-label="Main" className="ml-4 hidden gap-1 md:flex">
            {visible.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {profile && (
              <Badge tone="brand" className="hidden sm:inline-flex">
                {ROLE_LABELS[profile.role]}
              </Badge>
            )}
            <NavLink
              to="/app/profile"
              aria-label="Your profile"
              className="grid size-9 place-items-center rounded-full border border-line bg-sunken text-xs font-semibold text-ink-2 transition-colors hover:text-ink"
            >
              {initials(profile?.full_name ?? null, session?.user.email)}
            </NavLink>
            <Button variant="ghost" size="sm" onClick={onSignOut} className="hidden sm:inline-flex">
              Sign out
            </Button>
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
                className="rounded-control px-3 py-2 text-left text-sm font-medium text-ink-2 hover:bg-sunken hover:text-ink"
              >
                Sign out
              </button>
            </div>
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        {/* Signed in but role unknown — every role-gated screen will be closed,
            so say why once here rather than leaving empty panels unexplained. */}
        {profileError && (
          <Alert tone="warning" title="Running without a confirmed role" className="mb-6">
            {profileError} Some screens will stay locked until this resolves.
          </Alert>
        )}
        <Outlet />
      </main>
    </div>
  )
}
