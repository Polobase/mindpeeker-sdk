import { phaseModulate, type Rate, rateMask, TAU, xorImprint } from '@mindpeeker/rate'
import type { BroadcastMode } from '../types.js'

/** One modulation stream fed round by round. */
export interface RoundModulator {
  /** Modulate the next round; the rate's ring index continues from the previous round. */
  modulate(raw: Uint8Array): Promise<Uint8Array>
  /** Release the underlying modulation generator. Idempotent. */
  close(): Promise<void>
}

/**
 * A single-slot async iterable: `rate`'s streaming modulators pull exactly one
 * chunk per `next()`, so pushing one round and pulling one output keeps a
 * single generator — and a single running ring index — across all rounds.
 */
class RoundFeed implements AsyncIterable<Uint8Array> {
  #pending: Uint8Array | undefined

  push(chunk: Uint8Array): void {
    this.#pending = chunk
  }

  [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    return {
      next: async (): Promise<IteratorResult<Uint8Array>> => {
        const value = this.#pending
        this.#pending = undefined
        return value === undefined ? { done: true, value: undefined } : { done: false, value }
      },
    }
  }
}

function streamModulator(
  feed: RoundFeed,
  gen: AsyncGenerator<Uint8Array | Float64Array>,
  map: (out: Uint8Array | Float64Array) => Uint8Array,
): RoundModulator {
  let closed = false
  return {
    async modulate(raw) {
      feed.push(raw)
      const step = await gen.next()
      return step.done === true ? new Uint8Array(0) : map(step.value)
    },
    async close() {
      if (closed) return
      closed = true
      await gen.return(undefined)
    },
  }
}

/**
 * The modulation of a whole broadcast as **one** stream, so the concatenated
 * ticks equal the rate package's own transform of the concatenated raw rounds:
 *
 * - `'xor'`: `xorImprint(rawStream, rate)` — byte $j$ of the broadcast is
 *   XORed with `mask[j mod r]`, reversible by one `xorImprint` pass over the
 *   stored output (applying it twice is the identity);
 * - `'phase'`: `phaseModulate(rawStream, rate)` quantized to a byte,
 *   $\operatorname{round}(256\,\phi/2\pi) \bmod 256$;
 * - `'mask'`: the rate mask keystream `rateMask(rate, ·)` continued across
 *   rounds (the raw bytes are discarded).
 *
 * In 0.1 each round restarted the ring index at 0, so the concatenated output
 * was not a transform of the raw stream whenever `roundBytes` was not a
 * multiple of the digit count.
 */
export function roundModulator(mode: BroadcastMode, rate: Rate): RoundModulator {
  if (mode === 'mask') {
    const period = rateMask(rate, rate.digits.length)
    const r = period.length
    let j = 0
    return {
      async modulate(raw) {
        const out = new Uint8Array(raw.length)
        for (let k = 0; k < out.length; k++) {
          out[k] = period[j] as number
          j = j + 1 === r ? 0 : j + 1
        }
        return out
      },
      async close() {},
    }
  }
  const feed = new RoundFeed()
  if (mode === 'phase') {
    return streamModulator(feed, phaseModulate(feed, rate), (phases) => {
      const out = new Uint8Array(phases.length)
      for (let k = 0; k < phases.length; k++) {
        out[k] = Math.round(((phases[k] as number) / TAU) * 256) % 256
      }
      return out
    })
  }
  return streamModulator(feed, xorImprint(feed, rate), (bytes) => bytes as Uint8Array)
}
