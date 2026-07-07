import type { EntropyProvider, EntropySourceInfo, EntropyStreamOptions } from '../types.js'
import { iterateBytes } from './byte-source.js'
import {
  type ConditionerConfig,
  type ConditioningOptions,
  collectBytes,
  condition,
} from './condition.js'
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
  defaultTimeoutMs?: number
  defaultChunkBytes?: number
}

const CONDITIONED_BLOCK_BYTES = 32

/**
 * The convergence point for all local physical-noise providers: wires a raw
 * sample session through health tests + conditioning (or raw passthrough)
 * into the standard EntropyProvider contract. getBytes opens one session per
 * call; stream() holds one lazy session for the iterator's lifetime.
 */
export function sampledProvider(
  spec: SampledSpec,
  opts: ConditioningOptions = {},
): EntropyProvider {
  const mode = opts.conditioning ?? 'conditioned'
  // Raw mode is visible in the name — and therefore in attribution — so a
  // result can always be traced to whitened vs unprocessed physical bits.
  const name = mode === 'raw' ? `${spec.name}(raw)` : spec.name
  const info: EntropySourceInfo = Object.freeze({ name, kind: spec.kind, privacy: spec.privacy })
  const config: ConditionerConfig = {
    provider: name,
    minEntropyPerSample: opts.minEntropyPerSample ?? spec.defaultMinEntropyPerSample,
    safetyFactor: opts.safetyFactor ?? spec.defaultSafetyFactor,
    mode,
  }

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
      async function* session(): AsyncGenerator<Uint8Array> {
        yield* condition(iterateBytes(spec.open(streamOpts.signal), streamOpts.signal), config)
      }
      const natural = mode === 'conditioned' ? CONDITIONED_BLOCK_BYTES : -1
      const inner = session()
      return chunkBytes === natural ? inner : rechunk(inner, chunkBytes)
    },
  })
}
