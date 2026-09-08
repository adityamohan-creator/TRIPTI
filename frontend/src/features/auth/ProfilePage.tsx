import { type FormEvent, useState } from 'react'
import { Alert } from '../../components/ui/Alert'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card, CardBody, CardHeader } from '../../components/ui/Card'
import { Input } from '../../components/ui/Field'
import { SkeletonList } from '../../components/ui/Skeleton'
import { useToast } from '../../components/ui/toast-context'
import { patch } from '../../lib/api'
import { ROLE_LABELS, type Profile } from '../../types/api'
import { useAuth } from './auth-context'

export function ProfilePage() {
  const { profile, session, profileError } = useAuth()

  if (profileError) {
    return (
      <Alert tone="danger" title="Could not load your profile">
        {profileError}
      </Alert>
    )
  }
  if (!profile) return <SkeletonList rows={2} />

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Your profile</h1>
        <p className="mt-1 text-sm text-ink-2">
          How coordinators reach you when a mission involves you.
        </p>
      </div>

      <Card>
        <CardHeader
          title="Account"
          description={session?.user.email ?? undefined}
          action={<Badge tone="brand">{ROLE_LABELS[profile.role]}</Badge>}
        />
        <CardBody>
          {/* Keyed on the profile id so the form's initial state comes straight
              from props — no effect syncing server data into local state. */}
          <ProfileForm key={profile.id} profile={profile} />
        </CardBody>
      </Card>
    </div>
  )
}

function ProfileForm({ profile }: { profile: Profile }) {
  const { refreshProfile } = useAuth()
  const toast = useToast()

  const [fullName, setFullName] = useState(profile.full_name ?? '')
  const [phone, setPhone] = useState(profile.phone ?? '')
  const [org, setOrg] = useState(profile.org ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await patch<{ profile: Profile }>('/profile', {
        full_name: fullName.trim() || null,
        phone: phone.trim() || null,
        org: org.trim() || null,
      })
      await refreshProfile()
      toast.success('Profile saved')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not save your profile.'
      setError(message)
      toast.error('Could not save', message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}

      <Input
        label="Full name"
        autoComplete="name"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
      />
      <Input
        label="Phone"
        type="tel"
        autoComplete="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        hint="Shared only with the coordinator running a mission you are on."
      />
      <Input
        label="Organisation"
        autoComplete="organization"
        value={org}
        onChange={(e) => setOrg(e.target.value)}
      />

      <div className="flex items-center gap-3 pt-1">
        <Button type="submit" loading={saving}>
          Save changes
        </Button>
        <p className="text-xs text-ink-3">
          Your role is set by an administrator and cannot be changed here.
        </p>
      </div>
    </form>
  )
}
