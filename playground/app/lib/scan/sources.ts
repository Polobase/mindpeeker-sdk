// Synthetic byte sources for the scan page: positive controls with a *known*
// defect, so a detection can be shown rather than asserted. CLIENT-ONLY
// (imports @mindpeeker/*).
//
// Every source here is structurally a `ByteSource` — `{ name, stream(opts) }` —
// which is all `@mindpeeker/scan` ever asks for.

import { EntropyError } from '@mindpeeker/entropy'
import type { ByteSource, ByteStreamOptions } from '@mindpeeker/scan'

/** The binary expansion of `p ∈ [0, 1)`, `width` bits, most significant first. */
export function probabilityBits(p: number, width = 30): Uint8Array {
  const bits = new Uint8Array(width)
  let x = Math.min(Math.max(p, 0), 1)
  for (let i = 0; i < width; i++) {
    x *= 2
    const bit = x >= 1 ? 1 : 0
    bits[i] = bit
    if (bit === 1) x -= 1
  }
  return bits
}

/**
 * Wrap a fair source into one whose every output bit is 1 with probability
 * exactly `p` — a deliberately broken RNG.
 *
 * The bias is exact, not approximate: a uniform binary fraction
 * $U = 0.b_1b_2\ldots$ is compared with the binary expansion of $p$ one input
 * bit at a time and the comparison stops at the first bit where they differ, so
 * $P(U < p) = p$ and the expected input cost is **2 input bits per output
 * bit** (Knuth–Yao). At `p = 0.5` the wrapper is exactly fair, which is what
 * makes it usable as its own negative control.
 */
export function biasedSource(input: ByteSource, p: number, label?: string): ByteSource {
  const bits = probabilityBits(p)
  const name = label ?? `synthetic-bias(P(1)=${p.toFixed(3)})`
  return {
    name,
    async *stream(opts?: ByteStreamOptions): AsyncIterable<Uint8Array> {
      const chunkBytes = Math.max(1, Math.min(opts?.chunkBytes ?? 64, 1 << 16))
      let out = new Uint8Array(chunkBytes)
      let index = 0
      let acc = 0
      let filled = 0
      let k = 0
      for await (const chunk of input.stream(opts)) {
        for (const byte of chunk) {
          for (let i = 7; i >= 0; i--) {
            const b = (byte >> i) & 1
            const pk = bits[k] ?? 0
            let decided: number
            if (b < pk) decided = 1
            else if (b > pk) decided = 0
            else {
              k += 1
              // Ran out of expansion: the remaining bits of p are 0, so U ≥ p.
              if (k < bits.length) continue
              decided = 0
            }
            k = 0
            acc = (acc << 1) | decided
            filled += 1
            if (filled === 8) {
              out[index] = acc
              index += 1
              acc = 0
              filled = 0
            }
            if (index === chunkBytes) {
              yield out
              out = new Uint8Array(chunkBytes)
              index = 0
            }
          }
        }
      }
      if (index > 0) yield out.subarray(0, index)
    },
  }
}

/**
 * A source that *fails* partway through — a stuck device tripping its health
 * test, not a source that politely ends. `@mindpeeker/scan` must turn this into
 * `ScanError('source_error')` with the provider's own error as `cause`, never
 * into a short, clean-looking receipt.
 */
export function failingSource(input: ByteSource, failAfterBytes: number): ByteSource {
  return {
    name: `flaky-device(${input.name})`,
    async *stream(opts?: ByteStreamOptions): AsyncIterable<Uint8Array> {
      let sent = 0
      for await (const chunk of input.stream(opts)) {
        if (sent + chunk.length >= failAfterBytes) {
          const keep = Math.max(0, failAfterBytes - sent)
          if (keep > 0) yield chunk.subarray(0, keep)
          throw new EntropyError(
            'health_test',
            `repetition-count alarm after ${failAfterBytes} bytes (simulated stuck device)`,
            { provider: input.name },
          )
        }
        sent += chunk.length
        yield chunk
      }
    },
  }
}

/** A source that ends cleanly after `bytes` bytes — the `insufficient_entropy` path. */
export function finiteSource(input: ByteSource, bytes: number): ByteSource {
  return {
    name: `finite(${input.name}, ${bytes}B)`,
    async *stream(opts?: ByteStreamOptions): AsyncIterable<Uint8Array> {
      let sent = 0
      for await (const chunk of input.stream(opts)) {
        if (sent + chunk.length >= bytes) {
          const keep = bytes - sent
          if (keep > 0) yield chunk.subarray(0, keep)
          return
        }
        sent += chunk.length
        yield chunk
      }
    },
  }
}

/** Rename a source (scanTripolar requires the control arm's name to differ). */
export function renameSource(input: ByteSource, name: string): ByteSource {
  return { name, stream: (opts?: ByteStreamOptions) => input.stream(opts) }
}
