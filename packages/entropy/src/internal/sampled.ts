import type { EntropyProvider, EntropySourceInfo, EntropyStreamOptions } from '../types.js'
import { iterateBytes } from './byte-source.js'
import {
  type ConditionerConfig,
  type ConditioningOptions,
  collectBytes,
  condition,
  DEFAULT_MAX_HEALTH_FAILURES,
} from './condition.js'
import { guardStream } from './guard-stream.js'
import { requireEntropyPerByte, requireFinite, requireInteger, requireOneOf } from './options.js'
import { defineProvider } from './provider.js'
import { rechunk } from './stream.js'

export interface SampledSpec extends EntropySourceInfo {
  /**
   * Open a raw-sample session. The returned iterable must stop sampling and
   * release the underlying hardware when the iterator is closed (return())
   * or the signal aborts — put cleanup in the generator's finally block.
   */
  open(signal?: AbortSignal): AsyncIterable<Uint8Array>
  /** Conservative assessed min-entropy in bits per raw sample byte. */
  defaultMinEntropyPerSample: number
  defaultSafetyFactor: number
  /** Stricter H for health-testing than for crediting (see ConditionerConfig). */
  defaultHealthMinEntropyPerSample?: number
  defaultTimeoutMs?: number
  defaultChunkBytes?: number
}

const CONDITIONED_BLOCK_BYTES = 32

/**
 * Validate the conditioning options at the public boundary and resolve them
 * against the spec defaults. Throws `EntropyError('invalid_request')`.
 */
export function resolveConditioning(
  spec: SampledSpec,
  opts: ConditioningOptions,
): ConditionerConfig & { onHealthFailure: 'throw' | 'retest'; maxHealthFailures: number } {
  const mode = requireOneOf(
    opts.conditioning ?? 'conditioned',
    ['conditioned', 'raw'] as const,
    'conditioning',
    spec.name,
  )
  const name = mode === 'raw' ? `${spec.name}(raw)` : spec.name
  const credited = requireEntropyPerByte(
    opts.minEntropyPerSample ?? spec.defaultMinEntropyPerSample,
    'minEntropyPerSample',
    name,
  )
  const safetyFactor = requireFinite(
    opts.safetyFactor ?? spec.defaultSafetyFactor,
    'safetyFactor',
    { min: 1 },
    name,
  )
  const specHealth =
    spec.defaultHealthMinEntropyPerSample === undefined
      ? credited
      : requireEntropyPerByte(
          spec.defaultHealthMinEntropyPerSample,
          'defaultHealthMinEntropyPerSample',
          name,
        )
  const onHealthFailure = requireOneOf(
    opts.onHealthFailure ?? 'retest',
    ['throw', 'retest'] as const,
    'onHealthFailure',
    name,
  )
  const maxHealthFailures = requireInteger(
    opts.maxHealthFailures ?? DEFAULT_MAX_HEALTH_FAILURES,
    'maxHealthFailures',
    1,
    name,
  )
  return {
    provider: name,
    minEntropyPerSample: credited,
    safetyFactor,
    // Never health-test looser than the credit: a user raising the credited H
    // above the provider's stricter health H raises the health H with it.
    healthMinEntropyPerSample: Math.max(credited, specHealth),
    mode,
    onHealthFailure,
    maxHealthFailures,
  }
}

/**
 * The convergence point for all local physical-noise providers: wires a raw
 * sample session through health tests (start-up + continuous, with restart
 * semantics) and conditioning (or raw passthrough) into the standard
 * EntropyProvider contract. getBytes opens one session per call; stream()
 * holds one lazy session for the iterator's lifetime, maps aborts and source
 * failures to `EntropyError`, and applies `timeoutMs` (when given) per chunk.
 *
 * Options are validated here, at construction: an out-of-range
 * `minEntropyPerSample` (finite, 0 < H ≤ 8), `safetyFactor` (finite, ≥ 1),
 * `conditioning`, `onHealthFailure` or `maxHealthFailures` (integer ≥ 1)
 * throws `EntropyError('invalid_request')`.
 */
export function sampledProvider(
  spec: SampledSpec,
  opts: ConditioningOptions = {},
): EntropyProvider {
  const config = resolveConditioning(spec, opts)
  const { mode } = config
  // Raw mode is visible in the name — and therefore in attribution — so a
  // result can always be traced to whitened vs unprocessed physical bits.
  const name = config.provider
  const info: EntropySourceInfo = Object.freeze({ name, kind: spec.kind, privacy: spec.privacy })

  return defineProvider({
    ...info,
    defaultTimeoutMs: spec.defaultTimeoutMs,
    defaultChunkBytes: spec.defaultChunkBytes ?? CONDITIONED_BLOCK_BYTES,

    async getBytes(length, reqOpts) {
      // iterateBytes races every pull against the composite signal so even a
      // non-cooperative source honors abort/timeout; collectBytes returns
      // early once satisfied and its close propagates through condition()
      // into the source's finally block.
      const raw = iterateBytes(spec.open(reqOpts?.signal), reqOpts?.signal)
      const stream = condition(raw, config)
      return { bytes: await collectBytes(stream, length, name), sources: [info] }
    },

    stream(streamOpts: EntropyStreamOptions = {}) {
      const chunkBytes = streamOpts.chunkBytes ?? spec.defaultChunkBytes ?? CONDITIONED_BLOCK_BYTES
      const natural = mode === 'conditioned' ? CONDITIONED_BLOCK_BYTES : -1
      return guardStream(
        (signal) => {
          const session = condition(iterateBytes(spec.open(signal), signal), config)
          return chunkBytes === natural ? session : rechunk(session, chunkBytes)
        },
        { provider: name, signal: streamOpts.signal, timeoutMs: streamOpts.timeoutMs },
      )
    },
  })
}
