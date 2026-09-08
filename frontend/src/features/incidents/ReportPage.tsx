import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Alert } from '../../components/ui/Alert'
import { SeverityBadge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Input, Textarea } from '../../components/ui/Field'
import { post } from '../../lib/api'
import { formatQuantity } from '../../lib/format'
import type { ExtractionResponse } from '../../types/api'

const MIN_LENGTH = 10

const EXAMPLE =
  'Flooding near Sector 62 since last night. Around 300 people are stuck on upper floors, including elderly residents. Food and drinking water are urgently needed.'

export function ReportPage() {
  const navigate = useNavigate()

  const [reportText, setReportText] = useState('')
  const [phone, setPhone] = useState('')
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ExtractionResponse | null>(null)

  const tooShort = reportText.trim().length > 0 && reportText.trim().length < MIN_LENGTH
  const coordsIncomplete = (lat.trim() === '') !== (lon.trim() === '')

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)

    if (coordsIncomplete) {
      setError('Give both latitude and longitude, or neither.')
      return
    }

    setSubmitting(true)
    try {
      const response = await post<ExtractionResponse>('/incidents', {
        report_text: reportText.trim(),
        reporter_phone: phone.trim() || undefined,
        lat: lat.trim() === '' ? undefined : Number(lat),
        lon: lon.trim() === '' ? undefined : Number(lon),
      })
      setResult(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not file this report.')
    } finally {
      setSubmitting(false)
    }
  }

  if (result) return <ExtractionReview result={result} onDone={() => navigate('/app/incidents')} />

  return (
    <section className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Report an emergency</h1>
        <p className="mt-1 text-sm text-ink-2">
          Write it however it comes out, in any language. Nothing has to be structured —
          that is what happens next.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}

        <Textarea
          label="What is happening?"
          required
          rows={7}
          value={reportText}
          onChange={(e) => setReportText(e.target.value)}
          placeholder={EXAMPLE}
          error={tooShort ? `Write at least ${MIN_LENGTH} characters.` : null}
          hint="Where it is, roughly how many people, and what they need most."
        />

        <Input
          label="Your phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          hint="Optional. Only a coordinator running the response can see it — it is never shown on the board."
        />

        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Latitude"
            type="number"
            step="any"
            value={lat}
            onChange={(e) => setLat(e.target.value)}
            error={coordsIncomplete ? 'Needs a pair' : null}
          />
          <Input
            label="Longitude"
            type="number"
            step="any"
            value={lon}
            onChange={(e) => setLon(e.target.value)}
            error={coordsIncomplete ? 'Needs a pair' : null}
          />
        </div>
        <p className="-mt-2 text-xs text-ink-3">
          Optional, and never guessed from the text. Without coordinates a coordinator
          locates it by hand before anything can be matched to it.
        </p>

        <Button
          type="submit"
          size="lg"
          loading={submitting}
          disabled={reportText.trim().length < MIN_LENGTH}
        >
          {submitting ? 'Reading the report…' : 'File this report'}
        </Button>
      </form>
    </section>
  )
}

/**
 * What the extraction produced, shown back to the reporter before they leave.
 *
 * Deliberately framed as a proposal rather than a result: the confidence, the
 * open questions, and whether a model read it at all are all stated plainly. The
 * incident is already saved as `open` — this screen changes nothing, it just
 * refuses to pretend the machine understood more than it did.
 */
function ExtractionReview({
  result,
  onDone,
}: {
  result: ExtractionResponse
  onDone: () => void
}) {
  const { extraction, incident, source, degradedReason } = result
  const degraded = source === 'fallback'

  return (
    <section className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Report filed</h1>
        <p className="mt-1 text-sm text-ink-2">
          It is on the coordinators' board now. Here is what was read from it — none of
          it is treated as fact until a person confirms it.
        </p>
      </div>

      {degraded ? (
        <Alert tone="warning" title="Nothing has read this report yet">
          AI extraction was unavailable{degradedReason ? ` (${degradedReason})` : ''}, so
          the fields below come from a keyword scan only. A coordinator will read the
          report itself.
        </Alert>
      ) : (
        <Alert tone="info" title="This is a proposal, not a record">
          A coordinator confirms severity and location before anything is dispatched.
        </Alert>
      )}

      <Card>
        <CardHeader
          title={extraction.summary || 'No summary'}
          description={`Filed ${new Date(incident.created_at).toLocaleString()}`}
          action={<SeverityBadge severity={extraction.severity} />}
        />
        <CardBody>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            <Field label="Category" value={extraction.category} />
            <Field
              label="Location"
              value={extraction.location_text ?? 'Not stated — needs locating'}
            />
            <Field
              label="People affected"
              value={
                extraction.people_affected != null
                  ? extraction.people_affected.toLocaleString()
                  : 'Not stated'
              }
            />
            <Field
              label="Confidence"
              value={degraded ? 'Not applicable' : `${Math.round(extraction.confidence * 100)}%`}
            />
          </dl>

          <h3 className="mt-6 text-xs font-medium uppercase tracking-wide text-ink-3">
            Needs identified
          </h3>
          {extraction.needs.length === 0 ? (
            <p className="mt-2 text-sm text-ink-2">
              None were identified. That does not mean there are none.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-line border-y border-line">
              {extraction.needs.map((need, index) => (
                <li key={index} className="flex items-baseline justify-between gap-4 py-2">
                  <span className="text-sm capitalize text-ink">{need.kind}</span>
                  <span className="text-sm text-ink-2 tabular">
                    {need.quantity == null
                      ? 'Amount not stated'
                      : formatQuantity(need.quantity, need.unit)}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {extraction.unclear.length > 0 && (
            <>
              <h3 className="mt-6 text-xs font-medium uppercase tracking-wide text-ink-3">
                Open questions
              </h3>
              <ul className="mt-2 space-y-1.5">
                {extraction.unclear.map((item, index) => (
                  <li key={index} className="flex gap-2 text-sm text-ink-2">
                    <span aria-hidden="true" className="text-ink-3">
                      —
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardBody>
      </Card>

      <div className="flex gap-2">
        <Button onClick={onDone}>Back to incidents</Button>
        <Link to="/app/incidents/new">
          <Button variant="secondary">File another</Button>
        </Link>
      </div>
    </section>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-sm capitalize text-ink">{value}</dd>
    </div>
  )
}
