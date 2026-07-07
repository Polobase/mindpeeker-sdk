import { EntropyError } from '../errors.js'
import type {
  EntropyProvider,
  EntropyRequestOptions,
  EntropyResult,
  EntropySourceInfo,
  EntropyStreamOptions,
} from '../types.js'
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

/**
 * Wraps a provider implementation with the cross-cutting contract every
 * provider must honor: length validation (`invalid_request`), abort handling
 * (`aborted`), a whole-call timeout budget (`timeout`), and a default
 * poll-based `stream()`. The impl receives a composite AbortSignal that fires
 * on either caller abort or timeout expiry.
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
          {
            provider: name,
          },
        )
      }
      if (opts.signal?.aborted) {
        throw new EntropyError('aborted', 'request aborted before start', { provider: name })
      }
      const timeoutMs = opts.timeoutMs ?? spec.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS
      const timeoutSignal = AbortSignal.timeout(timeoutMs)
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal
      try {
        return await spec.getBytes(length, { ...opts, signal, timeoutMs })
      } catch (error) {
        if (error instanceof EntropyError) {
          // A nested provider saw our composite signal abort and reported
          // 'aborted' — if that abort was our own timeout, reclassify.
          if (error.code === 'aborted' && !opts.signal?.aborted && timeoutSignal.aborted) {
            throw new EntropyError('timeout', `request exceeded ${timeoutMs}ms`, {
              provider: name,
              cause: error,
            })
          }
          throw error
        }
        if (opts.signal?.aborted) {
          throw new EntropyError('aborted', 'request aborted', { provider: name, cause: error })
        }
        if (timeoutSignal.aborted) {
          throw new EntropyError('timeout', `request exceeded ${timeoutMs}ms`, {
            provider: name,
            cause: error,
          })
        }
        throw error
      }
    },

    stream(opts = {}) {
      return spec.stream ? spec.stream(opts) : pollStream(provider, opts, defaultChunkBytes)
    },
  }

  return Object.freeze(provider)
}
