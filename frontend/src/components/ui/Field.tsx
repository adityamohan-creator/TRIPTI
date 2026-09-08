import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { useId } from 'react'
import { cn } from '../../lib/cn'

const CONTROL =
  'w-full rounded-lg border border-line-strong bg-raised px-3 py-2 text-sm text-ink ' +
  'placeholder:text-ink-3 transition-colors ' +
  'focus:border-brand-500 disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-3 ' +
  'aria-[invalid=true]:border-danger'

function Wrapper({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  required?: boolean
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {/* The hint is hidden once there is an error, so the two never compete. */}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-sm text-ink-3">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

interface BaseProps {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
}

export function Input({
  label,
  hint,
  error,
  className,
  ...rest
}: BaseProps & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <Wrapper id={id} label={label} hint={hint} error={error} required={rest.required}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(CONTROL, 'h-10', className)}
        {...rest}
      />
    </Wrapper>
  )
}

export function Textarea({
  label,
  hint,
  error,
  className,
  ...rest
}: BaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId()
  return (
    <Wrapper id={id} label={label} hint={hint} error={error} required={rest.required}>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(CONTROL, 'min-h-28 resize-y', className)}
        {...rest}
      />
    </Wrapper>
  )
}

export function Select({
  label,
  hint,
  error,
  className,
  children,
  ...rest
}: BaseProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId()
  return (
    <Wrapper id={id} label={label} hint={hint} error={error} required={rest.required}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(CONTROL, 'h-10', className)}
        {...rest}
      >
        {children}
      </select>
    </Wrapper>
  )
}
