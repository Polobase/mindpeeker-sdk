import { EntropyError } from '../errors.js'
import type {
  EntropyProvider,
  EntropyRequestOptions,
  EntropyResult,
  EntropySourceInfo,
  EntropyStreamOptions,
} from '../types.js'
import { toEntropyError } from './composite.js'
import { requireTimeoutMs } from './options.js'
import { pollStream } from './stream.js'

export const DEFAULT_TIMEOUT_MS = 10_000

export interface ProviderSpec extends EntropySourceInfo {
  getBytes(length: number, opts?: EntropyRequestOptions): Promise<EntropyResult>
  stream?(opts?: EntropyStreamOptions): AsyncIterable<Uint8Array>
  /** Natural chunk size for the default poll-based stream. */
  defaultChunkBytes?: number
  /** Whole-call timeout when the caller passes none (composites need more room). */
  defaultTimeoutMs?: number
}

/** A stream whose first pull rejects with `error` (keeps `stream()` itself lazy and total). */
function failingStream(error: EntropyError): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => Promise.reject(error),
      return: () => Promise.resolve({ done: true as const, value: undefined }),
    }),
  }
}

function streamOptionsError(opts: EntropyStreamOptions, provider: string): EntropyError | null {
  const { chunkBytes, timeoutMs } = opts
  if (chunkBytes !== undefined && !(Number.isSafeInteger(chunkBytes) && chunkBytes >= 1)) {
    return new EntropyError(
      'invalid_request',
      `chunkBytes must be an integer >= 1, got ${String(chunkBytes)}`,
      { provider },
    )
  }
  if (timeoutMs !== undefined) {
    try {
      requireTimeoutMs(timeoutMs, 'timeoutMs', provider)
    } catch (error) {
      return error as EntropyError
    }
  }
  return null
}

/**
 * Run one provider call under the request contract: validates `timeoutMs`
 * (finite, 0 < ms ≤ 2³¹ − 1) with `invalid_request`, rejects a pre-aborted
 * signal with `aborted`, hands `run` a composite signal (caller abort OR
 * timeout), maps a caller abort to `aborted` and an expired budget to
 * `timeout`, and wraps foreign failures as `network` (original as `cause`).
 */
export async function runWithBudget<T>(
  name: string,
  opts: EntropyRequestOptions,
  defaultTimeoutMs: number,
  run: (signal: AbortSignal, timeoutMs: number) => Promise<T>,
): Promise<T> {
  if (opts.timeoutMs !== undefined) requireTimeoutMs(opts.timeoutMs, 'timeoutMs', name)
  if (opts.signal?.aborted) {
    throw new EntropyError('aborted', 'request aborted before start', { provider: name })
  }
  const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal
  try {
    return await run(signal, timeoutMs)
  } catch (error) {
    if (opts.signal?.aborted) {
      if (error instanceof EntropyError && error.code === 'aborted') throw error
      throw new EntropyError('aborted', 'request aborted', { provider: name, cause: error })
    }
    // A nested provider or source saw our composite signal fire: if that
    // was our own timeout, report it as such.
    const interrupted =
      !(error instanceof EntropyError) ||
      error.code === 'aborted' ||
      error.code === 'insufficient_entropy'
    if (timeoutSignal.aborted && interrupted) {
      throw new EntropyError('timeout', `request exceeded ${timeoutMs}ms`, {
        provider: name,
        cause: error,
      })
    }
    throw toEntropyError(error, name)
  }
}

/**
 * Wraps a provider implementation with the cross-cutting contract every
 * provider must honor:
 *
 * - `getBytes` validates `length` (integer ≥ 1) and `timeoutMs` (finite,
 *   0 < ms ≤ 2³¹ − 1) with `invalid_request`, passes the impl a composite
 *   AbortSignal (caller abort OR timeout), maps a caller abort to `aborted` and
 *   an expired budget to `timeout`, wraps foreign impl failures as `network`
 *   (original error as `cause`), and verifies the impl returned exactly
 *   `length` bytes (`bad_response` otherwise);
 * - `stream` validates `chunkBytes` (integer ≥ 1) and `timeoutMs` the same way
 *   — rejecting on the first pull — and falls back to a poll-based stream
 *   (one `getBytes` per pull) when the impl has none.
 */
export function defineProvider(spec: ProviderSpec): EntropyProvider {
  const { name, kind, privacy, defaultChunkBytes } = spec

  const provider: EntropyProvider = {
    name,
    kind,
    privacy,

    async getBytes(length, opts = {}) {
      if (!Number.isInteger(length) || length < 1) {
        throw new EntropyError(
          'invalid_request',
          `requested length must be a positive integer, got ${length}`,
          { provider: name },
        )
      }
      const result = await runWithBudget(
        name,
        opts,
        spec.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
        (signal, timeoutMs) => spec.getBytes(length, { ...opts, signal, timeoutMs }),
      )
      const bytes = result?.bytes
      if (!(bytes instanceof Uint8Array) || bytes.length !== length) {
        throw new EntropyError(
          'bad_response',
          `provider returned ${bytes instanceof Uint8Array ? `${bytes.length} bytes` : typeof bytes} for a ${length}-byte request`,
          { provider: name },
        )
      }
      return result
    },

    stream(opts = {}) {
      const invalid = streamOptionsError(opts, name)
      if (invalid) return failingStream(invalid)
      return spec.stream ? spec.stream(opts) : pollStream(provider, opts, defaultChunkBytes)
    },
  }

  return Object.freeze(provider)
}
