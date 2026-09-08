type ClassValue = string | false | null | undefined

/**
 * Joins class names, dropping falsy entries.
 *
 * Deliberately not `clsx` — this is the whole of what the codebase uses it for.
 *
 * It does NOT resolve Tailwind conflicts, which matters: if a component's base
 * classes set a property and a caller passes a different value for the same
 * property, both end up on the element and Tailwind's stylesheet order decides
 * the winner, not the caller. `hidden` passed to a component whose base sets
 * `inline-flex` loses, and the element stays visible.
 *
 * So put responsive visibility on a wrapper element rather than passing a
 * display utility into a component. Reach for `tailwind-merge` only if this
 * starts happening for properties a wrapper cannot express.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ')
}
