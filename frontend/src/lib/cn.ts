type ClassValue = string | false | null | undefined

/**
 * Joins class names, dropping falsy entries. Deliberately not `clsx` — this is
 * the whole of what the codebase uses it for, and it is four lines.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ')
}
