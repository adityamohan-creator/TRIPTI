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

const PRINCIPLES = [
  {
    title: 'The model reads. The engine decides.',
    body: 'Language understanding is an AI problem. Deciding who gets the last water truck is not. Allocation runs on pure, unit-tested functions that give the same answer every time and can be explained to a coordinator afterwards.',
  },
  {
    title: 'Nothing dispatches on a guess',
    body: 'Extracted fields arrive with a confidence score and an explicit list of what was unclear. Incidents open as open and stay there until a person triages them. Coordinates are never invented.',
  },
  {
    title: 'Every decision leaves a record',
    body: 'Status history is append-only. A review after the fact can reconstruct exactly what was known, when it was known, and who acted on it.',
  },
]

function Wordmark() {
  return (
    <Link to="/" className="flex items-center gap-2">
      <span className="grid size-7 place-items-center rounded-control bg-action text-[11px] font-bold text-action-fg shadow-solid">
        T
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-ink">TRIPTI</span>
    </Link>
  )
}

export function Landing() {
  const { session } = useAuth()

  return (
    <div className="min-h-screen bg-page">
      <header className="sticky top-0 z-30 border-b border-line bg-page/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-6">
          <Wordmark />
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

      <section className="glow relative overflow-hidden border-b border-line">
        <div className="relative mx-auto max-w-5xl px-6 py-24 sm:py-32">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-raised px-3 py-1 text-xs text-ink-2 shadow-raised">
            <span className="size-1.5 rounded-full bg-sev-critical" aria-hidden="true" />
            Disaster response coordination
          </span>

          <h1 className="mt-6 max-w-3xl text-[2.75rem] font-semibold leading-[1.05] tracking-tight text-ink sm:text-6xl">
            Turn crisis reports into missions that actually reach people.
          </h1>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-ink-2">
            Information, volunteers, vehicles and surplus food end up scattered across a
            dozen groups while food expires and needs go unmet. TRIPTI reads what came
            in, ranks it by who needs help most, and matches it against what is
            genuinely available nearby.
          </p>

          <div className="mt-9 flex flex-wrap gap-2.5">
            <Link to={session ? '/app' : '/register'}>
              <Button size="lg">{session ? 'Open dashboard' : 'Create an account'}</Button>
            </Link>
            <Link to="/login">
              <Button size="lg" variant="secondary">
                Sign in
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="border-b border-line bg-sunken">
        <div className="mx-auto max-w-5xl px-6 py-20">
          <h2 className="text-xs font-medium uppercase tracking-[0.14em] text-ink-3">
            How a response runs
          </h2>
          <ol className="mt-10 grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((item) => (
              <li key={item.step} className="bg-raised p-6">
                <span className="font-mono text-[11px] font-medium text-ink-3">
                  {item.step}
                </span>
                <h3 className="mt-3 text-sm font-semibold text-ink">{item.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
                  {item.body}
                </p>
              </li>
            ))}
            {/* The grid's own background shows through as the hairlines between
                cells, so an incomplete last row would leave a stripe of line
                colour instead of surface. Five steps plus this filler divides
                evenly into both two and three columns. */}
            <li className="bg-raised" aria-hidden="true" />
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-20">
        <div className="grid gap-10 lg:grid-cols-3">
          {PRINCIPLES.map((item) => (
            <div key={item.title}>
              <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8">
          <Wordmark />
          <span className="text-xs text-ink-3">
            Built for coordinators, volunteers, donors and the people waiting.
          </span>
        </div>
      </footer>
    </div>
  )
}
