// Synthetic series for the flow page, built from bytes of the header-selected
// entropy source. CLIENT-ONLY: it imports @mindpeeker/flow.
//
// The construction is deliberately transparent: the symbols of the *driving*
// series are the source's own bits (MSB-first, through the SDK's
// `symbolsFromBytes`), and every coin flip of the coupling — "does Y copy X
// here?", "is the copied bit flipped?" — comes from `xoshiro128ss` seeded with
// four more bytes of the same draw. So one draw fixes the whole picture, and a
// deterministic source reproduces it byte for byte.

import { symbolsFromBytes, xoshiro128ss } from '@mindpeeker/flow'
import type { LabParams } from './types'

export type Rng = () => number

/** Bytes to draw for `n` binary samples: ⌈n/8⌉ bits plus a 4-byte PRNG seed. */
export function bytesForBits(n: number): number {
  return Math.ceil(n / 8) + 4
}

/** A non-negative safe integer seed from four bytes. */
export function seedFrom(bytes: ArrayLike<number>, offset = 0): number {
  const at = (i: number): number => (bytes[offset + i] as number | undefined) ?? 0
  return at(0) * 0x1000000 + at(1) * 0x10000 + at(2) * 0x100 + at(3)
}

/** The package's surrogate PRNG (xoshiro128**), seeded from the draw. */
export function rngFrom(bytes: ArrayLike<number>, offset = 0): Rng {
  return xoshiro128ss(seedFrom(bytes, offset))
}

/** The first `n` MSB-first bits of `bytes` as 0/1 symbols. */
export function bitsFrom(bytes: Uint8Array, n: number): Uint8Array {
  const bits = symbolsFromBytes(bytes.subarray(0, Math.ceil(n / 8)), { alphabet: 2 })
  return bits.length === n ? bits : bits.slice(0, n)
}

/** Lag at which the common driver Z enters X. */
export const DRIVER_LAG_X = 1
/** Lag at which the common driver Z enters Y — one more, so X *looks* like Y's cause. */
export const DRIVER_LAG_Y = 2

export interface CoupledSeries {
  x: Uint8Array
  y: Uint8Array
  z: Uint8Array
  seed: number
  sourceBits: number
}

/**
 * X, Y and the common driver Z.
 *
 * - `z[t]` — fresh PRNG bits.
 * - `x[t]` — the source's bit, replaced by `z[t-1]` with probability `driver`.
 * - `y[t]` — `x[t-lag]` (flipped with probability `noise`) with probability
 *   `coupling`; otherwise `z[t-2]` with probability `driver`; otherwise a fresh
 *   PRNG bit.
 *
 * With `coupling = 0` and `driver > 0` this is the textbook confound: nothing
 * flows from X to Y, yet `x[t]` carries `z[t-1]` and `y[t+1]` *is* `z[t-1]`, so
 * the unconditioned transfer entropy at lag 1 is large.
 */
export function coupledPair(bytes: Uint8Array, params: LabParams): CoupledSeries {
  const n = params.n
  const lag = params.lag
  const coupling = params.coupling / 100
  const noise = params.noise / 100
  const driver = params.driver / 100
  const bits = bitsFrom(bytes, n)
  const seed = seedFrom(bytes, Math.ceil(n / 8))
  const rng = xoshiro128ss(seed)

  const z = new Uint8Array(n)
  for (let t = 0; t < n; t++) z[t] = rng() < 0.5 ? 1 : 0

  const x = new Uint8Array(n)
  for (let t = 0; t < n; t++) {
    const driven = driver > 0 && t >= DRIVER_LAG_X && rng() < driver
    x[t] = driven ? (z[t - DRIVER_LAG_X] as number) : (bits[t] as number)
  }

  const y = new Uint8Array(n)
  for (let t = 0; t < n; t++) {
    const u = rng()
    if (u < coupling && t >= lag) {
      const flip = noise > 0 && rng() < noise ? 1 : 0
      y[t] = ((x[t - lag] as number) ^ flip) as number
    } else if (u < coupling + driver && t >= DRIVER_LAG_Y) {
      y[t] = z[t - DRIVER_LAG_Y] as number
    } else {
      y[t] = rng() < 0.5 ? 1 : 0
    }
  }
  return { x, y, z, seed, sourceBits: n }
}

export interface MemoryChainParams {
  n: number
  /** The chain repeats the symbol `memory` steps back… */
  memory: number
  /** …with this probability, in percent; otherwise it takes a fresh source bit. */
  persistence: number
}

/** A binary chain whose only memory is at lag `memory` — AIS(k) should step up at k = memory. */
export function memoryChain(bytes: Uint8Array, params: MemoryChainParams): Uint8Array {
  const { n, memory } = params
  const p = params.persistence / 100
  const bits = bitsFrom(bytes, n)
  const rng = rngFrom(bytes, Math.ceil(n / 8))
  const s = new Uint8Array(n)
  for (let t = 0; t < n; t++) {
    s[t] = t >= memory && rng() < p ? (s[t - memory] as number) : (bits[t] as number)
  }
  return s
}

export interface SinePairParams {
  n: number
  /** Samples per full cycle. */
  period: number
  /** Uniform noise amplitude added to both signals (0…1). */
  noise: number
  /** Y follows X by this many samples. */
  lag: number
  /** How much of X's value carries over into Y. */
  gain: number
}

/** A continuous driver and its delayed, noisy follower — for ordinal patterns. */
export function sinePair(
  bytes: Uint8Array,
  params: SinePairParams,
): { x: Float64Array; y: Float64Array } {
  const { n, period, noise, lag, gain } = params
  const rng = rngFrom(bytes, 0)
  const x = new Float64Array(n)
  const y = new Float64Array(n)
  const w = (2 * Math.PI) / period
  for (let t = 0; t < n; t++) x[t] = Math.sin(w * t) + noise * (rng() * 2 - 1)
  for (let t = 0; t < n; t++) {
    const driven = t >= lag ? gain * (x[t - lag] as number) : 0
    y[t] = driven + noise * (rng() * 2 - 1)
  }
  return { x, y }
}

/**
 * The empirical p(y_{t+1} = 1 | y_t, x_{t-lag+1}) table — the four conditional
 * probabilities transfer entropy compares. Identical columns ⇒ TE 0.
 */
export interface NextBitCell {
  readonly label: string
  readonly p: number
  readonly count: number
}

export function nextBitTable(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  lag: number,
): NextBitCell[] {
  const ones = [0, 0, 0, 0]
  const total = [0, 0, 0, 0]
  const n = Math.min(x.length, y.length)
  for (let t = Math.max(0, lag - 1); t < n - 1; t++) {
    const cell = ((y[t] as number) & 1) * 2 + ((x[t - lag + 1] as number) & 1)
    total[cell] = (total[cell] as number) + 1
    if ((y[t + 1] as number) === 1) ones[cell] = (ones[cell] as number) + 1
  }
  return [0, 1, 2, 3].map((cell) => {
    const count = total[cell] as number
    return {
      label: `yₜ=${cell >> 1}, xₜ₋ᵤ₊₁=${cell & 1}`,
      p: count > 0 ? (ones[cell] as number) / count : Number.NaN,
      count,
    }
  })
}

/** Two rows of symbols (X above, Y below) for a HeatmapCanvas strip. */
export function bitStrip(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  cols: number,
): { data: Float64Array; rows: number; cols: number } {
  const width = Math.min(cols, x.length, y.length)
  const data = new Float64Array(width * 2)
  for (let i = 0; i < width; i++) {
    data[i] = x[i] as number
    data[width + i] = y[i] as number
  }
  return { data, rows: 2, cols: width }
}

/** Counts of each ordinal pattern, as frequencies. */
export function patternFrequencies(symbols: ArrayLike<number>, alphabet: number): Float64Array {
  const counts = new Float64Array(alphabet)
  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i] as number
    if (s >= 0 && s < alphabet) counts[s] = (counts[s] as number) + 1
  }
  if (symbols.length > 0) for (let i = 0; i < alphabet; i++) counts[i] = (counts[i] as number) / symbols.length
  return counts
}
