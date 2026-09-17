import type { BetaPrior } from '@mindpeeker/psi'
import { ScanError } from '../errors.js'
import type { ByteSource, Catalog } from '../types.js'

/** Throw `ScanError('invalid_options')`. */
export function invalid(message: string): never {
  throw new ScanError('invalid_options', message)
}

function show(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value)
}

/** An integer in `[min, max]` (default max: `Number.MAX_SAFE_INTEGER`). */
export function integerIn(
  value: unknown,
  name: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    const upper = max === Number.MAX_SAFE_INTEGER ? '' : `, ≤ ${max}`
    invalid(`${name} must be an integer ≥ ${min}${upper}; got ${show(value)}`)
  }
  return value
}

/** A finite number `≥ min`. */
export function finiteAtLeast(value: unknown, name: string, min: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    invalid(`${name} must be a finite number ≥ ${min}; got ${show(value)}`)
  }
  return value
}

/** A finite number in the half-open interval `(lo, hi]`. */
export function inHalfOpen(value: unknown, name: string, lo: number, hi: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= lo || value > hi) {
    invalid(`${name} must be a finite number in (${lo}, ${hi}]; got ${show(value)}`)
  }
  return value
}

/** A significance level in the open interval `(0, 1)`. */
export function alphaLevel(value: unknown, name = 'alpha'): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= 1) {
    invalid(`${name} must be a finite number in (0, 1); got ${show(value)}`)
  }
  return value
}

/** One of the listed string values. */
export function oneOf<T extends string>(value: unknown, name: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    invalid(`${name} must be one of ${allowed.join(', ')}; got ${show(value)}`)
  }
  return value as T
}

/** A boolean. */
export function bool(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') invalid(`${name} must be a boolean; got ${show(value)}`)
  return value
}

/** An options bag: `undefined` becomes `{}`; anything but a plain object is rejected. */
export function optionsObject<T extends object>(opts: T | undefined, name: string): T {
  if (opts === undefined) return {} as T
  if (typeof opts !== 'object' || opts === null || Array.isArray(opts)) {
    invalid(`${name} must be an object`)
  }
  return opts
}

/** A Beta prior with finite shapes `> 0` (defaults 1, 1); `undefined` stays `undefined`. */
export function betaPrior(prior: unknown): BetaPrior | undefined {
  if (prior === undefined) return undefined
  if (typeof prior !== 'object' || prior === null) invalid('prior must be an object { a, b }')
  const { a = 1, b = 1 } = prior as BetaPrior
  for (const [key, shape] of [
    ['prior.a', a],
    ['prior.b', b],
  ] as const) {
    if (typeof shape !== 'number' || !Number.isFinite(shape) || shape <= 0) {
      invalid(`${key} must be a finite number > 0; got ${show(shape)}`)
    }
  }
  return Object.freeze({ a, b })
}

/** An AbortSignal (duck-typed so signals from another realm pass). */
export function abortSignal(signal: unknown): AbortSignal | undefined {
  if (signal === undefined) return undefined
  if (
    typeof signal !== 'object' ||
    signal === null ||
    typeof (signal as AbortSignal).aborted !== 'boolean' ||
    typeof (signal as AbortSignal).addEventListener !== 'function'
  ) {
    invalid('signal must be an AbortSignal')
  }
  return signal as AbortSignal
}

/** A {@link ByteSource}: a non-empty string `name` and a `stream()` method. */
export function byteSource(source: unknown, name = 'source'): ByteSource {
  if (
    typeof source !== 'object' ||
    source === null ||
    typeof (source as ByteSource).name !== 'string' ||
    (source as ByteSource).name.length === 0 ||
    typeof (source as ByteSource).stream !== 'function'
  ) {
    invalid(`${name} must be a ByteSource { name, stream() } with a non-empty name`)
  }
  return source as ByteSource
}

/**
 * A scannable catalog: an object with a non-empty `items` array whose entries
 * have a non-empty `name` and a unique effective id (`id ?? name`).
 *
 * @throws {ScanError} `invalid_catalog`
 */
export function scannableCatalog(catalog: unknown): Catalog {
  if (typeof catalog !== 'object' || catalog === null) {
    throw new ScanError('invalid_catalog', 'catalog must be an object with items')
  }
  const { id, items } = catalog as Catalog
  if (!Array.isArray(items) || items.length === 0) {
    throw new ScanError('invalid_catalog', `catalog "${String(id)}" has no items`)
  }
  const seen = new Set<string>()
  items.forEach((item, i) => {
    if (typeof item !== 'object' || item === null) {
      throw new ScanError('invalid_catalog', `catalog "${String(id)}" item ${i} is not an object`)
    }
    if (typeof item.name !== 'string' || item.name.length === 0) {
      throw new ScanError('invalid_catalog', `catalog "${String(id)}" item ${i} has no name`)
    }
    const key = item.id ?? item.name
    if (typeof key !== 'string' || key.length === 0) {
      throw new ScanError('invalid_catalog', `catalog "${String(id)}" item ${i} has an empty id`)
    }
    if (seen.has(key)) {
      throw new ScanError('invalid_catalog', `catalog "${String(id)}" has duplicate id "${key}"`)
    }
    seen.add(key)
  })
  return catalog as Catalog
}
