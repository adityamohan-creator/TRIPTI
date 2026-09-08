import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Alert } from '../../components/ui/Alert'
import { Badge, SeverityBadge, StatusBadge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Select } from '../../components/ui/Field'
import { Input } from '../../components/ui/Field'
import { SkeletonList } from '../../components/ui/Skeleton'
import { EmptyState, ErrorState } from '../../components/ui/States'
import { useToast } from '../../components/ui/toast-context'
import { useAsync } from '../../hooks/useAsync'
import { get, patch } from '../../lib/api'
import { formatQuantity, timeAgo } from '../../lib/format'
import {
  SEVERITIES,
  type IncidentDetail,
  type IncidentStatus,
  type Severity,
} from '../../types/api'
import { useAuth } from '../auth/auth-context'
import { GeocodeLookup } from './GeocodeLookup'
import { PriorityBreakdownCard } from './PriorityBreakdownCard'

const STATUSES: IncidentStatus[] = ['open', 'triaged', 'assigned', 'resolved']

export function IncidentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const toast = useToast()

  const { data, loading, error, reload } = useAsync(
    () => get<IncidentDetail>(`/incidents/${id}`),
    [id],
  )

  const canTriage = profile?.role === 'coordinator' || profile?.role === 'admin'

  if (loading) return <SkeletonList rows={4} />
  if (error) {
    return <ErrorState title="Could not load this incident" message={error} onRetry={reload} />
  }
  if (!data) return <EmptyState title="Incident not found" />

  const { incident, priorities, history } = data
  const needs = incident.needs ?? []
  const degraded = incident.ai_source === 'fallback'

  // The highest-scoring need is what actually determines where this incident
  // sits in the queue, so that is the breakdown worth showing first.
  const topNeedId = Object.entries(priorities).sort(
    (a, b) => b[1].score - a[1].score,
  )[0]?.[0]

  return (
    <section className="space-y-6">
      <div>
        <Link to="/app/incidents" className="text-xs text-ink-2 hover:text-ink">
          &larr; All incidents
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <SeverityBadge severity={incident.severity} />
          <StatusBadge status={incident.status} />
          {incident.category && (
            <span className="text-xs capitalize text-ink-3">{incident.category}</span>
          )}
          <span className="text-xs text-ink-3">{timeAgo(incident.created_at)}</span>
        </div>
        <h1 className="mt-2 text-xl font-semibold tracking-tight text-ink">
          {incident.summary ?? 'Untitled incident'}
        </h1>
      </div>

      {degraded && (
        <Alert tone="warning" title="These fields came from a keyword scan">
          AI extraction was unavailable when this arrived
          {incident.ai_degraded_reason ? ` (${incident.ai_degraded_reason})` : ''}, so
          nothing has read the report itself. Read it below before triaging.
        </Alert>
      )}

      {incident.lat == null && (
        <Alert tone="warning" title="Not located">
          Without coordinates this incident is excluded from the match plan. Set them
          below — they are never inferred from the report text.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="The report as filed"
              description={
                incident.source_language && incident.source_language !== 'und'
                  ? `Original language: ${incident.source_language}`
                  : undefined
              }
            />
            <CardBody>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                {incident.report_text}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Needs"
              description={`${needs.length} identified`}
              action={
                incident.people_affected != null ? (
                  <span className="text-xs text-ink-2 tabular">
                    {incident.people_affected.toLocaleString()} affected
                  </span>
                ) : undefined
              }
            />
            <CardBody className="p-0">
              {needs.length === 0 ? (
                <p className="px-5 py-4 text-sm text-ink-2">
                  None were identified. That does not mean there are none.
                </p>
              ) : (
                <ul className="divide-y divide-line">
                  {needs.map((need) => {
                    const priority = priorities[need.id]
                    return (
                      <li
                        key={need.id}
                        className="flex flex-wrap items-center gap-3 px-5 py-3"
                      >
                        <span className="text-sm font-medium capitalize text-ink">
                          {need.kind}
                        </span>
                        <span className="text-sm text-ink-2 tabular">
                          {formatQuantity(need.quantity, need.unit)}
                        </span>
                        <Badge tone="neutral" className="capitalize">
                          {need.status}
                        </Badge>
                        {priority && (
                          <span className="ml-auto text-xs text-ink-3 tabular">
                            priority {priority.score.toFixed(0)}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardBody>
          </Card>

          {incident.ai_unclear.length > 0 && (
            <Card>
              <CardHeader
                title="Flagged as unclear"
                description="Extraction refused to resolve these. Confirm before acting."
              />
              <CardBody>
                <ul className="space-y-1.5">
                  {incident.ai_unclear.map((item, index) => (
                    <li key={index} className="flex gap-2 text-sm text-ink-2">
                      <span aria-hidden="true" className="text-ink-3">
                        —
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="History" description="Append-only. Nothing here is edited." />
            <CardBody className="p-0">
              <ol className="divide-y divide-line">
                {history.map((entry) => (
                  <li key={entry.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-sm text-ink">
                        {entry.from_status ? `${entry.from_status} → ` : ''}
                        {entry.to_status}
                      </span>
                      <span className="ml-auto text-xs text-ink-3">
                        {timeAgo(entry.changed_at)}
                      </span>
                    </div>
                    {entry.note && (
                      <p className="mt-0.5 text-xs text-ink-2">{entry.note}</p>
                    )}
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          {topNeedId && priorities[topNeedId] && (
            <PriorityBreakdownCard
              breakdown={priorities[topNeedId]}
              title="Priority — highest need"
            />
          )}

          <Card>
            <CardHeader
              title="Extraction"
              description={degraded ? 'Keyword scan only' : incident.ai_provider ?? undefined}
            />
            <CardBody className="space-y-2 text-sm">
              <Row
                label="Confidence"
                value={
                  degraded || incident.ai_confidence == null
                    ? 'Not applicable'
                    : `${Math.round(incident.ai_confidence * 100)}%`
                }
              />
              <Row label="Stated location" value={incident.location_text ?? 'Not stated'} />
              <Row
                label="Vulnerable groups"
                value={
                  incident.vulnerable_groups.length > 0
                    ? incident.vulnerable_groups.join(', ')
                    : 'None reported'
                }
              />
            </CardBody>
          </Card>

          {canTriage && <TriagePanel incident={data} onSaved={reload} toast={toast} />}
        </div>
      </div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-ink-3">{label}</span>
      <span className="text-right text-sm text-ink">{value}</span>
    </div>
  )
}

/**
 * The human override. Everything the model proposed is editable here, and a
 * status change is recorded with whatever note the coordinator leaves — the
 * point of the audit trail is that a later reviewer can see the reasoning, not
 * just the change.
 */
function TriagePanel({
  incident: { incident },
  onSaved,
  toast,
}: {
  incident: IncidentDetail
  onSaved: () => void
  toast: ReturnType<typeof useToast>
}) {
  const [severity, setSeverity] = useState<Severity>(incident.severity)
  const [status, setStatus] = useState<IncidentStatus>(incident.status)
  const [lat, setLat] = useState(incident.lat != null ? String(incident.lat) : '')
  const [lon, setLon] = useState(incident.lon != null ? String(incident.lon) : '')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const coordsIncomplete = (lat.trim() === '') !== (lon.trim() === '')

  async function save() {
    if (coordsIncomplete) {
      toast.error('Coordinates need a pair', 'Give both latitude and longitude, or neither.')
      return
    }

    setSaving(true)
    try {
      await patch(`/incidents/${incident.id}`, {
        severity,
        status,
        ...(lat.trim() === ''
          ? {}
          : { lat: Number(lat), lon: Number(lon) }),
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      toast.success('Triage saved')
      setNote('')
      onSaved()
    } catch (err) {
      toast.error('Could not save', err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Triage" description="Your judgement overrides the extraction." />
      <CardBody className="space-y-3">
        <Select
          label="Severity"
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Severity)}
        >
          {SEVERITIES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>

        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as IncidentStatus)}
        >
          {STATUSES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>

        {/* Offered, never applied automatically — see GeocodeLookup. */}
        <GeocodeLookup
          initialQuery={incident.location_text ?? ''}
          onPick={(pickedLat, pickedLon) => {
            setLat(String(pickedLat))
            setLon(String(pickedLon))
          }}
        />

        <div className="grid grid-cols-2 gap-2">
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

        <Input
          label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          hint="Recorded against a status change, for whoever reviews this later."
        />

        <Button fullWidth loading={saving} onClick={save}>
          Save triage
        </Button>
      </CardBody>
    </Card>
  )
}
