import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { useId } from 'react'
import { cn } from '../../lib/cn'

const CONTROL =
  'w-full rounded-control border border-line-strong bg-raised px-3 text-[13px] text-ink ' +
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
      <label htmlFor={id} className="block text-[13px] font-medium text-ink">
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
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-xs text-ink-3">
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

/** React 19 passes ref as a plain prop to function components. */
interface WithRef<T> {
  ref?: Ref<T>
}

export function Input({
  label,
  hint,
  error,
  className,
  ...rest
}: BaseProps & WithRef<HTMLInputElement> & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <Wrapper id={id} label={label} hint={hint} error={error} required={rest.required}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(CONTROL, 'h-9', className)}
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
}: BaseProps & WithRef<HTMLTextAreaElement> & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId()
  return (
    <Wrapper id={id} label={label} hint={hint} error={error} required={rest.required}>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(CONTROL, 'min-h-24 resize-y py-2', className)}
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
}: BaseProps & WithRef<HTMLSelectElement> & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId()
  return (
    <Wrapper id={id} label={label} hint={hint} error={error} required={rest.required}>
      <select
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className={cn(CONTROL, 'h-9', className)}
        {...rest}
      >
        {children}
      </select>
    </Wrapper>
  )
}
