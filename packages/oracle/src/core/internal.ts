/// <reference lib="esnext.disposable" preserve="true" />
/**
 * Package-private plumbing shared by the reader implementations. Nothing in
 * here is re-exported from the package root.
 */
import { OracleError } from '../errors.js'
import type { ByteReader } from './reader.js'

/**
 * `Symbol.asyncDispose`, or the registered `Symbol.for('Symbol.asyncDispose')`
 * on runtimes that predate explicit resource management — so the method key
 * is never the string `'undefined'`.
 */
export const ASYNC_DISPOSE: typeof Symbol.asyncDispose = (Symbol.asyncDispose ??
  Symbol.for('Symbol.asyncDispose')) as typeof Symbol.asyncDispose

/**
 * Read protocol of this package's own readers: `next()` with extra per-call
 * AbortSignals. Wrappers use it so an abort leaves the wrapped reader usable
 * (the in-flight pull is kept and handed to the next read) instead of busy.
 */
export const READ: unique symbol = Symbol('@mindpeeker/oracle.read')

/** The innermost reader a wrapper delegates to — the key for the cast lease. */
export const ROOT: unique symbol = Symbol('@mindpeeker/oracle.root')

/** A reader implementing the package-private protocol. */
export interface InternalReader extends ByteReader {
  [READ](signals: readonly AbortSignal[]): Promise<number>
  readonly [ROOT]: ByteReader
}

export const NO_SIGNALS: readonly AbortSignal[] = Object.freeze([])

/** Upper bound on how long `close()` waits for a stream's `return()` to settle. */
export const CLOSE_TIMEOUT_MS = 250

export function isInternalReader(reader: ByteReader): reader is InternalReader {
  return typeof (reader as Partial<InternalReader>)[READ] === 'function'
}

/** The object a cast leases: the innermost reader behind any of our wrappers. */
export function rootOf(reader: ByteReader): ByteReader {
  return isInternalReader(reader) ? reader[ROOT] : reader
}

export const abortedError = (source?: string): OracleError =>
  new OracleError('aborted', 'byte reader aborted by caller signal', { source })

export const closedError = (source?: string): OracleError =>
  new OracleError('closed', 'byte reader is closed', { source })

export const busyError = (source?: string): OracleError =>
  new OracleError(
    'invalid_input',
    'reader is already in use: a shared ByteReader must be used sequentially',
    { source },
  )

/** Wrap a foreign failure of the input as `'source_error'`; OracleErrors pass through. */
export function sourceError(cause: unknown, source?: string): OracleError {
  if (cause instanceof OracleError) return cause
  const detail = cause instanceof Error ? cause.message : String(cause)
  return new OracleError('source_error', `input source failed: ${detail}`, { source, cause })
}

export function anyAborted(signals: readonly AbortSignal[]): boolean {
  for (const signal of signals) if (signal.aborted) return true
  return false
}

/**
 * Await `promise`, but reject with `'aborted'` as soon as any signal fires,
 * or with whatever error `register`'s canceller is called with. Listeners are
 * always removed; a late settlement of `promise` stays handled.
 */
export async function raceSignals<T>(
  promise: Promise<T>,
  signals: readonly AbortSignal[],
  source?: string,
  register?: (cancel: (err: OracleError) => void) => void,
): Promise<T> {
  if (anyAborted(signals)) throw abortedError(source)
  if (signals.length === 0 && register === undefined) return promise
  const cleanups: (() => void)[] = []
  const cancelled = new Promise<never>((_, reject) => {
    const onAbort = () => reject(abortedError(source))
    for (const signal of signals) {
      signal.addEventListener('abort', onAbort, { once: true })
      cleanups.push(() => signal.removeEventListener('abort', onAbort))
    }
    register?.(reject)
  })
  try {
    return await Promise.race([promise, cancelled])
  } finally {
    for (const cleanup of cleanups) cleanup()
  }
}

export function checkByte(value: unknown, source?: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
    throw new OracleError('invalid_input', `input yielded a non-byte value: ${String(value)}`, {
      source,
    })
  }
  return value
}

/**
 * Realm-independent byte-array check: `instanceof Uint8Array` fails for
 * arrays from another realm (iframe, `vm` context, worker transfer), the
 * `Symbol.toStringTag` of a typed array does not. `Int8Array` is excluded
 * (negative values), `Uint8ClampedArray` and Node's `Buffer` are accepted.
 */
export function isUint8View(value: unknown): value is Uint8Array {
  if (!ArrayBuffer.isView(value) || (value as Uint8Array).BYTES_PER_ELEMENT !== 1) return false
  const tag = (value as Uint8Array)[Symbol.toStringTag]
  return tag === 'Uint8Array' || tag === 'Uint8ClampedArray'
}

/** Structural AbortSignal check (cross-realm signals fail `instanceof`). */
export function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AbortSignal).aborted === 'boolean' &&
    typeof (value as AbortSignal).addEventListener === 'function' &&
    typeof (value as AbortSignal).removeEventListener === 'function'
  )
}

/** Resolve when `promise` settles or after `ms`, whichever comes first. Never rejects. */
export function boundedWait(promise: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    const done = () => {
      clearTimeout(timer)
      resolve()
    }
    promise.then(done, done)
  })
}
