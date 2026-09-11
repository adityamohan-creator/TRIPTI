import { useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { cn } from '../../lib/cn'
import { TOUR_STEPS } from './steps'

/**
 * A guided walkthrough of the full response, for someone seeing this for the
 * first time.
 *
 * Deliberately a docked panel rather than a spotlight overlay that dims the
 * page and points at buttons. The app stays fully usable while it is open —
 * the tour explains the screen you are on, it does not take the screen over.
 * Somebody following it should be doing the work, not watching a slideshow of
 * it.
 */

const DISMISSED_KEY = 'tripti.tour.dismissed'
const STEP_KEY = 'tripti.tour.step'

function read(key: string): string | null {
  // Storage throws outright in some embedded contexts, and a tour is the last
  // thing that should take a page down.
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* A tour that cannot remember its place is still a working tour. */
  }
}

export function DemoTour() {
  /*
   * Read once, during the first render, rather than in an effect that would
   * render the panel closed and then immediately reopen it.
   *
   * Open by default the first time someone arrives, because a walkthrough
   * nobody notices is no walkthrough — but dismissing it is remembered, so it
   * never reappears uninvited.
   */
  const [open, setOpen] = useState(() => read(DISMISSED_KEY) !== '1')
  const [index, setIndex] = useState(() => Number(read(STEP_KEY) ?? 0) || 0)
  const navigate = useNavigate()
  const location = useLocation()

  const step = TOUR_STEPS[index]

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(TOUR_STEPS.length - 1, next))
      setIndex(clamped)
      write(STEP_KEY, String(clamped))
      const target = TOUR_STEPS[clamped]
      if (target && target.path !== location.pathname) navigate(target.path)
    },
    [navigate, location.pathname],
  )

  const close = useCallback(() => {
    setOpen(false)
    write(DISMISSED_KEY, '1')
  }, [])

  // Escape closes it, like every other transient surface in the app.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          const target = TOUR_STEPS[index]
          if (target && target.path !== location.pathname) navigate(target.path)
        }}
        className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-2 rounded-control border border-line bg-raised px-3 py-2 text-sm font-medium text-ink shadow-overlay transition-colors hover:border-line-strong focus-visible:ring-2 focus-visible:ring-action focus-visible:outline-none"
      >
        <span className="inline-block size-1.5 rounded-full bg-positive" aria-hidden />
        Guided walkthrough
      </button>
    )
  }

  if (!step) return null

  const first = index === 0
  const last = index === TOUR_STEPS.length - 1

  return (
    <aside
      aria-label="Guided walkthrough"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-line bg-raised shadow-overlay sm:bottom-4 sm:left-auto sm:right-4 sm:max-w-md sm:rounded-card sm:border"
    >
      <div className="flex items-start gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">
            {step.eyebrow}
          </p>
          <h2 className="mt-0.5 text-sm font-semibold text-ink">{step.title}</h2>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Close the walkthrough"
          className="-mr-1 shrink-0 rounded-control px-2 py-1 text-sm text-ink-3 transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-action focus-visible:outline-none"
        >
          ✕
        </button>
      </div>

      <div className="space-y-3 px-4 py-3">
        <p className="text-sm text-ink-2">{step.action}</p>

        {/*
          The point is set apart rather than run together with the instruction.
          Anyone skimming reads one thing per step; this is the one worth
          reading.
        */}
        <div className="border-l-2 border-positive bg-sunken px-3 py-2">
          <p className="text-xs font-medium tracking-wide text-ink-3 uppercase">
            Why this matters
          </p>
          <p className="mt-1 text-sm text-ink-2">{step.point}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-line px-4 py-3">
        <div className="flex gap-1" aria-hidden>
          {TOUR_STEPS.map((s, i) => (
            <span
              key={s.path + s.eyebrow}
              className={cn(
                'h-1 w-4 rounded-full transition-colors',
                i === index ? 'bg-positive' : i < index ? 'bg-brand-300' : 'bg-line',
              )}
            />
          ))}
        </div>

        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => go(index - 1)} disabled={first}>
            Back
          </Button>
          {last ? (
            <Button size="sm" onClick={close}>
              Done
            </Button>
          ) : (
            <Button size="sm" onClick={() => go(index + 1)}>
              Next
            </Button>
          )}
        </div>
      </div>
    </aside>
  )
}
