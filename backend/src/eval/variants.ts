import { createHash } from 'node:crypto'

/**
 * Deterministic report variants for AI-03.
 *
 * The whole value of this file is that it is reproducible: the same message id
 * must produce the same variant on any machine, in any run, forever. So every
 * decision is derived from a hash of the id and nothing else — no randomness,
 * no clock, no locale-dependent string handling.
 *
 * A variant is a near-duplicate of its source message. That is the point: a
 * fusion system that cannot group a message with its own lightly-mangled twin
 * cannot group two eyewitness accounts of one flood either. Variants give the
 * clustering evaluation a floor it must clear.
 *
 * Because a variant IS its source in every sense that matters, the two must
 * never land on opposite sides of a train/evaluation split. See `split.ts`.
 */

/** Fixed by the task definition. Changing it changes every variant produced. */
const SALT = '20260911:'

/** Selected when the first digest byte mod 10 falls in this set. */
const SELECT_RESIDUES = new Set([0, 1, 2, 3, 4, 5])

export type TransformKind =
  | 'lowercase-strip-punctuation'
  | 'prepend-append'
  | 'truncate-tail'
  | 'positional-swap'

/** Index order is fixed by the task: h[1] mod 4 selects from this list. */
const TRANSFORMS: TransformKind[] = [
  'lowercase-strip-punctuation',
  'prepend-append',
  'truncate-tail',
  'positional-swap',
]

export interface VariantDecision {
  /** The message this was derived from. Never lost — it is the evidence link. */
  sourceId: string
  selected: boolean
  /** Null when the message was not selected for transformation. */
  transform: TransformKind | null
  /** First two digest bytes, for auditing a decision without rehashing. */
  digestPrefix: string
}

export interface Variant {
  /** Stable, derived: the source id with a fixed suffix. */
  variantId: string
  sourceId: string
  text: string
  transform: TransformKind
}

/**
 * `h` is the digest as bytes, so `h[0]` is a value in 0-255.
 *
 * Worth stating because "h[0] mod 10" also reads as "the first hex character",
 * which would select on the character code of '0'-'f' and produce a different,
 * lopsided distribution. Bytes are the standard reading and give the intended
 * ~60% selection rate; if the reference implementation means hex characters,
 * this is the single line to change.
 */
export function digestOf(messageId: string): Buffer {
  return createHash('sha256').update(SALT + messageId).digest()
}

/** Whether this message gets a variant, and which transformation it receives. */
export function decideVariant(messageId: string): VariantDecision {
  const h = digestOf(messageId)
  const selected = SELECT_RESIDUES.has(h[0]! % 10)

  return {
    sourceId: messageId,
    selected,
    transform: selected ? TRANSFORMS[h[1]! % 4]! : null,
    digestPrefix: h.subarray(0, 2).toString('hex'),
  }
}

// ------------------------------------------------------------- transforms

/**
 * ASCII punctuation only, per the task.
 *
 * Deliberately not a Unicode punctuation class: crisis reports carry Devanagari
 * danda, Arabic comma and CJK full stops, and stripping those would change far
 * more than the task specifies — and would make the output depend on the
 * runtime's Unicode tables rather than on the hash.
 */
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/g

function lowercaseStripPunctuation(text: string): string {
  return text.toLowerCase().replace(ASCII_PUNCTUATION, '')
}

function prependAppend(text: string): string {
  return `Update: ${text} Please verify.`
}

/**
 * Drops the last ceil(0.15n) whitespace-separated tokens, keeping at least one.
 *
 * Modelled on a truncated or cut-off report, which is exactly what arrives when
 * someone types in a hurry or a feed clips a message.
 */
function truncateTail(text: string): string {
  const tokens = text.split(/\s+/).filter(Boolean)
  if (tokens.length <= 1) return text

  const drop = Math.ceil(0.15 * tokens.length)
  const keep = Math.max(1, tokens.length - drop)
  return tokens.slice(0, keep).join(' ')
}

const ALPHANUMERIC = /[0-9A-Za-z]/

/**
 * Transposes the characters at positions 40, 80, 120 … with the one after,
 * where both are alphanumeric.
 *
 * A typo model: adjacent transposition is the most common real typing error.
 * Positions are 0-indexed, which is the reading that makes "40, 80, 120, ..."
 * an arithmetic sequence starting at the 41st character; a 1-indexed reading
 * shifts every swap by one and produces different output, so it is written
 * down here rather than left to be rediscovered from a failing comparison.
 *
 * Both characters must be alphanumeric, so a swap never moves whitespace and
 * never changes the token count.
 */
function positionalSwap(text: string): string {
  const chars = [...text]

  for (let i = 40; i + 1 < chars.length; i += 40) {
    const a = chars[i]!
    const b = chars[i + 1]!
    if (ALPHANUMERIC.test(a) && ALPHANUMERIC.test(b)) {
      chars[i] = b
      chars[i + 1] = a
    }
  }

  return chars.join('')
}

const APPLY: Record<TransformKind, (text: string) => string> = {
  'lowercase-strip-punctuation': lowercaseStripPunctuation,
  'prepend-append': prependAppend,
  'truncate-tail': truncateTail,
  'positional-swap': positionalSwap,
}

export function applyTransform(kind: TransformKind, text: string): string {
  return APPLY[kind](text)
}

/**
 * The variant for one message, or null when the hash did not select it.
 *
 * At most one variant per message, by the task definition.
 */
export function makeVariant(messageId: string, text: string): Variant | null {
  const decision = decideVariant(messageId)
  if (!decision.selected || !decision.transform) return null

  return {
    variantId: `${messageId}::v1`,
    sourceId: messageId,
    text: applyTransform(decision.transform, text),
    transform: decision.transform,
  }
}

/** Variants for a corpus, in input order. Messages not selected are skipped. */
export function makeVariants(
  messages: { id: string; text: string }[],
): Variant[] {
  const out: Variant[] = []
  for (const message of messages) {
    const variant = makeVariant(message.id, message.text)
    if (variant) out.push(variant)
  }
  return out
}
