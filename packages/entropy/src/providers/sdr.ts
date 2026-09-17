import { EntropyError } from '../errors.js'
import { packBits, vonNeumann } from '../internal/bits.js'
import { type ByteSource, iterateBytes, persistentBytes } from '../internal/byte-source.js'
import type { ConditioningOptions } from '../internal/condition.js'
import { requireInteger } from '../internal/options.js'
import { starvationGuard } from '../internal/queue.js'
import { sampledProvider } from '../internal/sampled.js'
import type { EntropyProvider } from '../types.js'

export interface SdrOptions extends ConditioningOptions {
  /** Raw IQ bytes, e.g. from rtlSdrSource (@mindpeeker/entropy/node). REQUIRED. */
  source: ByteSource
  /** Von Neumann debiasing over the LSB stream (rtl-entropy prior art). Default true. */
  debias?: boolean
  /**
   * IQ bytes (integer ≥ 0) discarded once, when the source is first read.
   * Default 4096 — only ~0.85 ms at 2.4 MS/s; raise it (e.g. 1_000_000) to
   * also skip tuner gain/PLL settling.
   */
  warmupBytes?: number
}

/** The 6 least significant bits of each raw IQ byte (top bits carry signal, not noise). */
export function iqLsbBits(chunk: Uint8Array): number[] {
  const bits: number[] = []
  for (const byte of chunk) {
    for (let b = 5; b >= 0; b--) bits.push((byte >> b) & 1)
  }
  return bits
}

/**
 * Software-defined-radio noise (RTL-SDR dongles): front-end thermal noise in
 * the ADC's low bits, tuned to quiet spectrum at max manual gain. COMMUNITY-
 * VERIFIED tier — RF injection attacks are demonstrated in the literature,
 * so treat this as a mixing source, never a sole root of trust.
 *
 * Throws `EntropyError('invalid_request')` at construction without a
 * `source`, or for an invalid `warmupBytes` or conditioning option.
 */
export function sdrEntropy(opts: SdrOptions): EntropyProvider {
  if (!opts?.source) {
    throw new EntropyError(
      'invalid_request',
      'sdrEntropy requires a { source } of raw IQ bytes — in Node use rtlSdrSource from @mindpeeker/entropy/node',
      { provider: 'sdr' },
    )
  }
  const { source, debias = true } = opts
  const warmupBytes = requireInteger(opts.warmupBytes ?? 4096, 'warmupBytes', 0, 'sdr')

  // The injected source is persistent: sessions read a shared view, warmup
  // and bit extraction are applied once for the source's lifetime, and
  // closing a session never closes the dongle stream (its owner does).
  const shared = persistentBytes(
    (async function* extracted(): AsyncGenerator<Uint8Array> {
      let skipped = 0
      let leftover: number[] = []
      // silent (von-Neumann-starved) in-memory IQ must not monopolise the microtask queue
      const tick = starvationGuard()
      for await (const chunk of iterateBytes(source)) {
        let iq = chunk
        if (skipped < warmupBytes) {
          const need = warmupBytes - skipped
          if (chunk.length <= need) {
            skipped += chunk.length
            await tick(false)
            continue
          }
          skipped = warmupBytes
          iq = chunk.slice(need)
        }
        let bits = iqLsbBits(iq)
        if (debias) bits = vonNeumann(bits)
        const [packed, rest] = packBits(leftover.concat(bits))
        leftover = rest
        if (packed.length > 0) yield packed
        await tick(packed.length > 0)
      }
    })(),
  )

  async function* open(signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    yield* shared(signal)
  }

  return sampledProvider(
    {
      name: 'sdr',
      kind: 'trng',
      privacy: 'private',
      open,
      defaultMinEntropyPerSample: 1,
      defaultSafetyFactor: 4,
      defaultTimeoutMs: 30_000,
    },
    opts,
  )
}
