import { type FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Field'
import { cn } from '../../lib/cn'
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  SELF_SERVICE_ROLES,
  type SelfServiceRole,
} from '../../types/api'
import { useAuth } from './auth-context'

const MIN_PASSWORD = 8

export function RegisterPage() {
  const { session, signUp, initialising } = useAuth()
  const navigate = useNavigate()

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<SelfServiceRole>('citizen')
  const [org, setOrg] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmationSent, setConfirmationSent] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  if (!initialising && session) return <Navigate to="/app" replace />

  const needsOrg = role === 'ngo' || role === 'donor'
  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (passwordTooShort) return

    setError(null)
    setSubmitting(true)
    try {
      const { needsEmailConfirmation } = await signUp({
        email: email.trim(),
        password,
        fullName: fullName.trim(),
        role,
        phone: phone.trim() || undefined,
        org: org.trim() || undefined,
      })

      if (needsEmailConfirmation) {
        setConfirmationSent(true)
        setSubmitting(false)
        return
      }
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account.')
      setSubmitting(false)
    }
  }

  if (confirmationSent) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Check your inbox
        </h1>
        <Alert tone="success" className="mt-4">
          We sent a confirmation link to <strong>{email}</strong>. Open it to finish
          setting up your account, then sign in.
        </Alert>
        <p className="mt-6 text-sm text-ink-2">
          <Link to="/login" className="font-medium text-brand-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Create an account</h1>
      <p className="mt-1 text-sm text-ink-2">
        Choose how you will take part. Operator and administrator access is granted by
        an existing administrator, not selected here.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}

        <fieldset>
          <legend className="text-sm font-medium text-ink">I am joining as</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {SELF_SERVICE_ROLES.map((option) => (
              <label
                key={option}
                className={cn(
                  'cursor-pointer rounded-control border p-3 transition-colors',
                  role === option
                    ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30'
                    : 'border-line hover:border-line-strong',
                )}
              >
                <input
                  type="radio"
                  name="role"
                  value={option}
                  checked={role === option}
                  onChange={() => setRole(option)}
                  className="sr-only"
                />
                <span className="block text-sm font-medium text-ink">
                  {ROLE_LABELS[option]}
                </span>
                <span className="mt-0.5 block text-xs text-ink-2">
                  {ROLE_DESCRIPTIONS[option]}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <Input
          label="Full name"
          autoComplete="name"
          required
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={`At least ${MIN_PASSWORD} characters.`}
          error={passwordTooShort ? `Use at least ${MIN_PASSWORD} characters.` : null}
        />
        <Input
          label="Phone"
          type="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          hint="Optional. Used to reach you about a mission, never shown publicly."
        />
        {needsOrg && (
          <Input
            label="Organisation"
            autoComplete="organization"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            hint="The shelter, NGO, restaurant or kitchen you represent."
          />
        )}

        <Button type="submit" fullWidth loading={submitting}>
          Create account
        </Button>
      </form>

      <p className="mt-6 text-sm text-ink-2">
        Already registered?{' '}
        <Link to="/login" className="font-medium text-brand-600 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}
