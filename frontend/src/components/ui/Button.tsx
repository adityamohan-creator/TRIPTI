import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '../../lib/cn'
import { Spinner } from './Spinner'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  // Monochrome by design: the primary action inverts the page rather than
  // picking a brand colour. It is the highest contrast available, and it leaves
  // colour free to mean something — severity, failure, a deadline. The inset
  // highlight is what makes a solid button read as a raised surface rather than
  // a flat rectangle.
  primary:
    'bg-action text-action-fg shadow-solid hover:bg-action-hover active:translate-y-px',
  secondary:
    'border border-line-strong bg-raised text-ink shadow-raised hover:bg-sunken active:translate-y-px',
  ghost: 'text-ink-2 hover:bg-sunken hover:text-ink',
  danger: 'bg-danger text-white shadow-solid hover:opacity-90 active:translate-y-px',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-3 text-[13px]',
  md: 'h-9 gap-2 px-3.5 text-[13px]',
  lg: 'h-11 gap-2 px-5 text-sm',
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  fullWidth?: boolean
  /** React 19 passes ref as a plain prop to function components. */
  ref?: Ref<HTMLButtonElement>
  children: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  className,
  disabled,
  children,
  ...rest
}: Props) {
  return (
    <button
      // A loading button stays in the tab order and keeps its label, so a screen
      // reader announces the state change rather than losing the control.
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap rounded-control',
        'font-medium transition-[background-color,box-shadow,transform,opacity] duration-150',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="size-3.5" />}
      {children}
    </button>
  )
}
