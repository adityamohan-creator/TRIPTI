import { cn } from '../../lib/cn'
import type { MatchTerm } from '../../types/api'

/**
 * Why the engine proposed this pairing.
 *
 * A coordinator who disagrees needs to see which term drove the decision, so
 * they can fix the input that is wrong instead of arguing with a number. This
 * is the whole reason allocation is a tested function rather than a model call.
 */
export function MatchRationale({ terms, score }: { terms: MatchTerm[]; score: number }) {
  return (
    <div className="rounded-control border border-line bg-sunken/50 p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-3">
          Why this pairing
        </span>
        <span className="text-sm font-semibold tabular text-ink">
          {score.toFixed(0)}
          <span className="ml-1 text-xs font-normal text-ink-3">of 100</span>
        </span>
      </div>

      <dl className="mt-2.5 space-y-2">
        {terms.map((term) => (
          <div key={term.key}>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[13px] text-ink">{term.label}</dt>
              <dd className="shrink-0 text-xs tabular text-ink-3">
                {term.points.toFixed(1)} of {(term.weight * 100).toFixed(0)}
              </dd>
            </div>

            {/* The track is the term's maximum, so a short bar means "this
                counted for little", not "this value is small". */}
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-line">
              <div
                className={cn(
                  'h-full rounded-full',
                  term.normalised >= 0.66
                    ? 'bg-positive'
                    : term.normalised >= 0.33
                      ? 'bg-warning'
                      : 'bg-danger',
                )}
                style={{ width: `${Math.max(0, Math.min(100, term.normalised * 100))}%` }}
              />
            </div>

            <p className="mt-0.5 text-xs text-ink-2">{term.detail}</p>
          </div>
        ))}
      </dl>
    </div>
  )
}
