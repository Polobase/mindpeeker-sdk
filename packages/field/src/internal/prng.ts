import type { ByteSource } from '@mindpeeker/oracle'
import { FieldError } from '../errors.js'

const MASK64 = (1n << 64n) - 1n
const GOLDEN_GAMMA = 0x9e3779b97f4a7c15n

/** splitmix64's output mix (Steele, Lea & Flood 2014). */
function mix64(value: bigint): bigint {
  let z = value & MASK64
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64
  return z ^ (z >> 31n)
}

function rotl32(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k))
}

/** Validate a Monte-Carlo seed: a non-negative safe integer or a bigint in [0, 2⁶⁴). */
export function checkSeed(seed: unknown): bigint {
  if (typeof seed === 'number' && Number.isSafeInteger(seed) && seed >= 0) return BigInt(seed)
  if (typeof seed === 'bigint' && seed >= 0n && seed <= MASK64) return seed
  throw new FieldError(
    'invalid_config',
    `seed must be a non-negative safe integer or a bigint in [0, 2^64), got ${String(seed)}`,
  )
}

/**
 * A deterministic, endless byte source: xoshiro128** (Blackman & Vigna 2018)
 * seeded from two splitmix64 outputs of `seed`, emitting each 32-bit output
 * big-endian. Statistical, not cryptographic — it only has to make a
 * Monte-Carlo null reproducible. Each `stream()` restarts from the seed.
 */
export function seededSource(seed: bigint): ByteSource {
  return {
    name: `field-seeded:${seed}`,
    async *stream() {
      let state = seed
      const outputs: bigint[] = []
      for (let i = 0; i < 2; i++) {
        state = (state + GOLDEN_GAMMA) & MASK64
        outputs.push(mix64(state))
      }
      const [o1, o2] = outputs as [bigint, bigint]
      const s = new Uint32Array([
        Number(o1 >> 32n),
        Number(o1 & 0xffffffffn),
        Number(o2 >> 32n),
        Number(o2 & 0xffffffffn),
      ])
      for (;;) {
        const chunk = new Uint8Array(1024)
        const view = new DataView(chunk.buffer)
        for (let off = 0; off < chunk.length; off += 4) {
          const s1 = s[1] as number
          const result = Math.imul(rotl32(Math.imul(s1, 5), 7), 9) >>> 0
          const t = s1 << 9
          s[2] = (s[2] as number) ^ (s[0] as number)
          s[3] = (s[3] as number) ^ s1
          s[1] = s1 ^ (s[2] as number)
          s[0] = (s[0] as number) ^ (s[3] as number)
          s[2] = (s[2] as number) ^ t
          s[3] = rotl32(s[3] as number, 11)
          view.setUint32(off, result)
        }
        yield chunk
      }
    },
  }
}
