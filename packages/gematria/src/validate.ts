/**
 * Boundary validation shared by the public entry points: every check throws the
 * package's own {@link GematriaError} with a code from its union, never a raw
 * `TypeError`.
 */

import { GematriaError } from './errors.js'
import type { NamesVariant } from './types.js'

/**
 * Assert that `text` is a string.
 *
 * @throws GematriaError `'invalid_input'` otherwise
 */
export function requireString(text: unknown, what = 'text'): asserts text is string {
  if (typeof text !== 'string') {
    throw new GematriaError('invalid_input', `${what} must be a string, got ${typeof text}`)
  }
}

/** Whether `value` is a non-null, non-array object (an options bag). */
export function isOptionsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const NAMES_VARIANTS: ReadonlySet<string> = new Set<NamesVariant>(['standard', 'plene'])

/** `ValueOptions` after validation, with every default filled in. */
export interface ResolvedValueOptions {
  readonly reverse: boolean
  readonly keepTen: boolean
  readonly namesVariant: NamesVariant
}

function optionalBoolean(bag: Record<string, unknown>, key: string): boolean {
  const v = bag[key]
  if (v === undefined) return false
  if (typeof v !== 'boolean') {
    throw new GematriaError('invalid_input', `${key} must be a boolean, got ${typeof v}`)
  }
  return v
}

/**
 * Validate the third argument of `value`/`letterValues` (a `reverse` boolean or
 * a `ValueOptions` bag) or the options of `analyze`.
 *
 * @throws GematriaError `'invalid_input'` for a non-boolean `reverse`/`keepTen`,
 *   an unknown `namesVariant`, or an argument that is neither a boolean nor an
 *   options object
 */
export function resolveValueOptions(arg: unknown): ResolvedValueOptions {
  if (arg === undefined) return { reverse: false, keepTen: false, namesVariant: 'standard' }
  if (typeof arg === 'boolean') return { reverse: arg, keepTen: false, namesVariant: 'standard' }
  if (!isOptionsObject(arg)) {
    throw new GematriaError(
      'invalid_input',
      `reverse must be a boolean or an options object, got ${typeof arg}`,
    )
  }
  const names = arg.namesVariant
  if (names !== undefined && (typeof names !== 'string' || !NAMES_VARIANTS.has(names))) {
    throw new GematriaError(
      'invalid_input',
      `namesVariant must be 'standard' or 'plene', got ${String(names)}`,
    )
  }
  return {
    reverse: optionalBoolean(arg, 'reverse'),
    keepTen: optionalBoolean(arg, 'keepTen'),
    namesVariant: (names as NamesVariant | undefined) ?? 'standard',
  }
}
