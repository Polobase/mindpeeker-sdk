import { packBits, vonNeumann } from '../internal/bits.js'
import { type ByteSource, iterateBytes, persistentBytes } from '../internal/byte-source.js'
import type { ConditioningOptions } from '../internal/condition.js'
import { sampledProvider } from '../internal/sampled.js'
import type { EntropyProvider } from '../types.js'

export interface SdrOptions extends ConditioningOptions {
  /** Raw IQ bytes, e.g. from rtlSdrSource (@mindpeeker/entropy/node). REQUIRED. */
  source: ByteSource
  /** Von Neumann debiasing over the LSB stream (rtl-entropy prior art). Default true. */
  debias?: boolean
  /** IQ bytes discarded at session start while tuner gain settles. Default 4096. */
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
 */
export function sdrEntropy(opts: SdrOptions): EntropyProvider {
  if (!opts?.source) {
    throw new TypeError(
      'sdrEntropy requires a { source } of raw IQ bytes — in Node use rtlSdrSource from @mindpeeker/entropy/node',
    )
  }
  const { source, debias = true, warmupBytes = 4096 } = opts

  // The injected source is persistent: sessions read a shared view, warmup
  // and bit extraction are applied once for the source's lifetime, and
  // closing a session never closes the dongle stream (its owner does).
  const shared = persistentBytes(
    (async function* extracted(): AsyncGenerator<Uint8Array> {
      let skipped = 0
      let leftover: number[] = []
      for await (const chunk of iterateBytes(source)) {
        let iq = chunk
        if (skipped < warmupBytes) {
          const need = warmupBytes - skipped
          if (chunk.length <= need) {
            skipped += chunk.length
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
