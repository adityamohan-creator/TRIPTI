import { Link } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { useAuth } from '../features/auth/auth-context'

const STEPS = [
  {
    step: '01',
    title: 'A report arrives',
    body: 'Free text, in any language, often from someone in distress. Nothing has to be structured first.',
  },
  {
    step: '02',
    title: 'It becomes structured',
    body: 'Claude extracts type, severity, people affected and needs — and flags what it is unsure of instead of guessing.',
  },
  {
    step: '03',
    title: 'A coordinator triages',
    body: 'Extraction is a proposal. A human confirms severity and location before anything moves.',
  },
  {
    step: '04',
    title: 'Resources are matched',
    body: 'Tested, deterministic functions rank needs and pick the nearest capable supply. No model decides who gets the truck.',
  },
  {
    step: '05',
    title: 'A mission dispatches',
    body: 'Volunteer, vehicle, route, live status, delivery verification, and the impact it produced.',
  },
]

export function Landing() {
  const { session } = useAuth()

  return (
    <div className="min-h-screen bg-page">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-4">
          <span className="grid size-8 place-items-center rounded-control bg-brand-600 text-sm font-bold text-white">
            T
          </span>
          <span className="text-base font-semibold tracking-tight text-ink">TRIPTI</span>
          <div className="ml-auto flex items-center gap-2">
            {session ? (
              <Link to="/app">
                <Button size="sm">Open dashboard</Button>
              </Link>
            ) : (
              <>
                <Link to="/login">
                  <Button variant="ghost" size="sm">
                    Sign in
                  </Button>
                </Link>
                <Link to="/register">
                  <Button size="sm">Get started</Button>
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
        <p className="text-sm font-medium uppercase tracking-widest text-brand-600">
          Disaster response coordination
        </p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-ink sm:text-5xl">
          Turn crisis reports into missions that actually reach people.
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-2">
          Information, volunteers, vehicles and surplus food end up scattered across a
          dozen groups while food expires and needs go unmet. TRIPTI is the layer that
          reads what came in, ranks it by who needs help most, and matches it against
          what is genuinely available nearby.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link to={session ? '/app' : '/register'}>
            <Button size="lg">{session ? 'Open dashboard' : 'Create an account'}</Button>
          </Link>
          <Link to="/login">
            <Button size="lg" variant="secondary">
              Sign in
            </Button>
          </Link>
        </div>
      </section>

      <section className="border-y border-line bg-sunken">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-ink-3">
            How a response runs
          </h2>
          <ol className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((item) => (
              <li key={item.step}>
                <span className="font-mono text-xs font-semibold text-brand-600">
                  {item.step}
                </span>
                <h3 className="mt-2 text-base font-semibold text-ink">{item.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{item.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-10 lg:grid-cols-3">
          <div>
            <h3 className="text-base font-semibold text-ink">
              The model reads. The engine decides.
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              Language understanding is an AI problem. Deciding who gets the last water
              truck is not. Allocation runs on pure, unit-tested functions that produce
              the same answer every time and can be explained to a coordinator
              afterwards.
            </p>
          </div>
          <div>
            <h3 className="text-base font-semibold text-ink">
              Nothing dispatches on a guess
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              Extracted fields arrive with a confidence score and an explicit list of
              what was unclear. Incidents open as <em>open</em> and stay there until a
              person triages them. Coordinates are never invented.
            </p>
          </div>
          <div>
            <h3 className="text-base font-semibold text-ink">
              Every decision leaves a record
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-ink-2">
              Status history is append-only. A review after the fact can reconstruct
              exactly what was known, when it was known, and who acted on it.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-8 text-sm text-ink-3">
          <span>TRIPTI — disaster response coordination</span>
          <span>Built for coordinators, volunteers, donors and the people waiting.</span>
        </div>
      </footer>
    </div>
  )
}
