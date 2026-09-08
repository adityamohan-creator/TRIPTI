import { useState } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Field'
import { get } from '../../lib/api'

interface Candidate {
  label: string
  lat: number
  lon: number
  confidence: number | null
  source: string
}

interface GeocodeResponse {
  candidates: Candidate[]
  provider: string
  error?: string
}

/**
 * Turns a place name into coordinates a coordinator chooses.
 *
 * Deliberately never applies a result on its own, and never picks the top hit
 * automatically. Coordinates are the one field this system refuses to infer:
 * extraction copies the place name and leaves lat/lon null, and a wrong
 * coordinate sends a truck to the wrong place with nothing downstream able to
 * notice. So the lookup offers, and a person decides.
 */
export function GeocodeLookup({
  initialQuery,
  onPick,
}: {
  initialQuery: string
  onPick: (lat: number, lon: number) => void
}) {
  const [query, setQuery] = useState(initialQuery)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  async function search() {
    if (query.trim().length < 3) {
      setError('Give at least three characters to look up.')
      return
    }

    setSearching(true)
    setError(null)
    try {
      const result = await get<GeocodeResponse>(
        `/geocode?q=${encodeURIComponent(query.trim())}`,
      )
      setCandidates(result.candidates)
      if (result.error) setError(result.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed.')
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="space-y-2 rounded-control border border-line bg-sunken/40 p-3">
      <Input
        label="Find coordinates"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void search()
          }
        }}
        hint="Searched against OpenStreetMap. Nothing is applied until you choose."
      />

      <Button size="sm" variant="secondary" onClick={search} loading={searching} fullWidth>
        Look up
      </Button>

      {error && <Alert tone="warning">{error}</Alert>}

      {candidates?.length === 0 && !error && (
        <p className="text-xs text-ink-2">
          Nothing found. Enter the coordinates by hand below, or try a nearby landmark.
        </p>
      )}

      {candidates && candidates.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-control border border-line bg-raised">
          {candidates.map((candidate, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => onPick(candidate.lat, candidate.lon)}
                className="w-full px-3 py-2 text-left transition-colors hover:bg-sunken"
              >
                <span className="block text-[13px] text-ink">{candidate.label}</span>
                <span className="mt-0.5 block text-xs tabular text-ink-3">
                  {candidate.lat.toFixed(4)}, {candidate.lon.toFixed(4)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
