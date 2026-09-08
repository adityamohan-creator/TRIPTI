import { Link, Outlet } from 'react-router-dom'

/**
 * Two-column sign-in frame: the form on the left, what the platform does on the
 * right. The panel collapses away below `lg` so the form owns a small screen.
 */
export function AuthLayout() {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-6 py-10 sm:px-12">
        <Link to="/" className="flex items-center gap-2 self-start">
          <span className="grid size-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            T
          </span>
          <span className="text-base font-semibold tracking-tight text-ink">TRIPTI</span>
        </Link>

        <div className="my-auto w-full max-w-sm py-12">
          <Outlet />
        </div>
      </div>

      <aside className="relative hidden overflow-hidden bg-inverse px-12 py-16 lg:flex lg:flex-col lg:justify-center">
        <p className="text-sm font-medium uppercase tracking-widest text-brand-300">
          Disaster response coordination
        </p>
        <p className="mt-4 max-w-md text-3xl font-semibold leading-tight text-ink-inverse">
          From a report typed in panic to a truck on the road.
        </p>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-inverse/70">
          TRIPTI reads incoming reports in any language, ranks them by who needs help
          most, and matches them against the food, water and shelter actually available
          nearby. A coordinator approves every dispatch.
        </p>

        <dl className="mt-10 grid max-w-md grid-cols-3 gap-6">
          {[
            ['Deterministic', 'Allocation is scored by tested functions, not a model.'],
            ['Explainable', 'Every match shows why it was proposed.'],
            ['Human-approved', 'Nothing dispatches without a person saying yes.'],
          ].map(([term, detail]) => (
            <div key={term}>
              <dt className="text-sm font-semibold text-ink-inverse">{term}</dt>
              <dd className="mt-1 text-xs leading-relaxed text-ink-inverse/60">{detail}</dd>
            </div>
          ))}
        </dl>
      </aside>
    </div>
  )
}
