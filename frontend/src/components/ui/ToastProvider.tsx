import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react'
import { cn } from '../../lib/cn'
import { type Toast, ToastContext, type ToastTone } from './toast-context'

const TONES: Record<ToastTone, string> = {
  info: 'border-line bg-raised text-ink',
  success: 'border-positive/40 bg-raised text-ink',
  warning: 'border-warning/40 bg-raised text-ink',
  danger: 'border-danger/40 bg-raised text-ink',
}

const ACCENT: Record<ToastTone, string> = {
  info: 'bg-brand-500',
  success: 'bg-positive',
  warning: 'bg-warning',
  danger: 'bg-danger',
}

const DURATION_MS = 5000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const show = useCallback(
    (toast: Omit<Toast, 'id'>) => {
      const id = nextId.current++
      setToasts((current) => [...current, { ...toast, id }])
      // Errors stay until dismissed. A failure that vanishes after five seconds
      // is a failure the user never got to read.
      if (toast.tone !== 'danger') {
        window.setTimeout(() => dismiss(id), DURATION_MS)
      }
    },
    [dismiss],
  )

  const api = useMemo(
    () => ({
      show,
      dismiss,
      success: (title: string, description?: string) =>
        show({ tone: 'success', title, description }),
      error: (title: string, description?: string) =>
        show({ tone: 'danger', title, description }),
    }),
    [show, dismiss],
  )

  return (
    <ToastContext value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex w-full max-w-sm gap-3 overflow-hidden rounded-lg border shadow-lg',
              TONES[toast.tone],
            )}
          >
            <span className={cn('w-1 shrink-0', ACCENT[toast.tone])} aria-hidden="true" />
            <div className="min-w-0 flex-1 py-3">
              <p className="text-sm font-medium">{toast.title}</p>
              {toast.description && (
                <p className="mt-0.5 text-sm text-ink-2">{toast.description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
              className="px-3 text-ink-3 transition-colors hover:text-ink"
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  )
}
