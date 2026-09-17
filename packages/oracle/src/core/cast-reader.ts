import { OracleError } from '../errors.js'
import type { OracleInput } from '../types.js'
import { rootOf } from './internal.js'
import { type ByteReader, byteReader, isByteReader } from './reader.js'

/** Chunk size a cast requests from a {@link ByteSource} it opens, unless overridden. */
export const DEFAULT_CAST_CHUNK_BYTES = 32

/** Options every cast accepts. */
export interface CastReaderOptions {
  /**
   * Aborts the cast with an OracleError `'aborted'` — also when the input is
   * a shared `ByteReader` (the cast then reads through an abortable view and
   * the shared reader stays open).
   */
  signal?: AbortSignal
  /**
   * Chunk size requested from a `ByteSource` the cast opens (default
   * {@link DEFAULT_CAST_CHUNK_BYTES} = 32, so a 3-byte hexagram does not pull
   * a provider's 1024-byte default chunk). A hint the source may ignore; has
   * no effect on other inputs, including an existing `ByteReader`.
   */
  chunkBytes?: number
}

/** Readers currently used by a cast, keyed by their innermost reader. */
const leased = new WeakSet<ByteReader>()

/** Reject `null` / non-object option bags at the public boundary. */
export function checkCastOptions(opts: unknown, cast: string): void {
  if (typeof opts !== 'object' || opts === null) {
    throw new OracleError('invalid_input', `${cast} options must be an object`)
  }
}

/** Reject a present-but-non-boolean flag (`1`, `'true'`, `'on'` would silently mean "off"). */
export function checkBooleanOption(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new OracleError('invalid_input', `${name} must be a boolean, got ${typeof value}`)
  }
}

/** Accounting snapshot: call the returned function at the end of the cast for the deltas. */
export function accountingFrom(
  reader: ByteReader,
): () => { readonly bytesConsumed: number; readonly bytesFetched?: number } {
  const startConsumed = reader.bytesConsumed
  const startFetched = reader.bytesFetched
  return () => {
    const fetched = reader.bytesFetched
    return {
      bytesConsumed: reader.bytesConsumed - startConsumed,
      ...(fetched !== undefined && startFetched !== undefined
        ? { bytesFetched: fetched - startFetched }
        : {}),
    }
  }
}

/**
 * Run a cast body against a reader for `input`, owning its lifecycle:
 *
 * - a reader the cast creates (from a batch, stream, or `ByteSource`) is
 *   closed in `finally`, so a live provider's stream is released whether the
 *   cast resolves, throws, or is aborted;
 * - a caller-supplied `ByteReader` is never closed; with `signal` the cast
 *   reads through an abortable view of it;
 * - a caller-supplied reader is leased for the duration of the cast: a
 *   second cast starting on the same (innermost) reader before the first
 *   settles throws `OracleError('invalid_input')`.
 *
 * @internal shared by every `cast*` function
 */
export async function withCastReader<T>(
  input: OracleInput | ByteReader,
  opts: CastReaderOptions,
  body: (reader: ByteReader) => Promise<T>,
): Promise<T> {
  const lease = isByteReader(input) ? rootOf(input) : undefined
  if (lease !== undefined) {
    if (leased.has(lease)) {
      throw new OracleError(
        'invalid_input',
        'reader is already in use by another cast: a shared ByteReader must be used sequentially',
      )
    }
    leased.add(lease)
  }
  try {
    const reader = byteReader(input, {
      signal: opts.signal,
      chunkBytes: opts.chunkBytes ?? DEFAULT_CAST_CHUNK_BYTES,
    })
    try {
      return await body(reader)
    } finally {
      if (reader !== input) await reader.close()
    }
  } finally {
    if (lease !== undefined) leased.delete(lease)
  }
}
