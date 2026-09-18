// Drawing rate digits from an entropy source without modulo bias, plus the
// small byte bookkeeping the modulation section needs. No SDK imports.

import { throwIfAborted } from '~/lib/async'

export interface DigitDraw {
  /** `count` digits, each uniform on `[0, base)`. */
  readonly digits: Uint8Array
  /** Bytes read from the source, including the ones rejection sampling threw away. */
  readonly bytesUsed: number
}

/** Largest multiple of `base` that fits in a byte — the acceptance window. */
export function acceptanceLimit(base: number): number {
  return Math.floor(256 / base) * base
}

/** Expected bytes per accepted digit: 256 / (⌊256/base⌋·base). */
export function bytesPerDigit(base: number): number {
  return 256 / acceptanceLimit(base)
}

/**
 * `count` uniform digits in `[0, base)` by rejection sampling: a byte at or
 * above ⌊256/base⌋·base is discarded rather than folded, so every digit is
 * exactly uniform (plain `byte % 44` would favour 0..35).
 */
export async function drawDigits(
  count: number,
  base: number,
  fetchBytes: (n: number) => Promise<Uint8Array>,
  opts: { signal?: AbortSignal } = {},
): Promise<DigitDraw> {
  const limit = acceptanceLimit(base)
  const digits = new Uint8Array(count)
  let filled = 0
  let bytesUsed = 0
  while (filled < count) {
    throwIfAborted(opts.signal)
    const want = Math.max(16, Math.ceil((count - filled) * bytesPerDigit(base) * 1.15))
    const bytes = await fetchBytes(want)
    bytesUsed += bytes.length
    for (let i = 0; i < bytes.length && filled < count; i++) {
      const b = bytes[i] as number
      if (b >= limit) continue
      digits[filled++] = b % base
    }
    if (bytes.length === 0) break
  }
  return { digits, bytesUsed }
}

/** 256-bin byte histogram (index = byte value). */
export function byteHistogram(bytes: ArrayLike<number>): Uint32Array {
  const counts = new Uint32Array(256)
  for (let i = 0; i < bytes.length; i++) counts[(bytes[i] as number) & 0xff]++
  return counts
}

/** Number of positions where two equal-length byte arrays differ. */
export function countDifferences(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length)
  let diff = Math.abs(a.length - b.length)
  for (let i = 0; i < n; i++) if ((a[i] as number) !== (b[i] as number)) diff++
  return diff
}

/** Drain an async byte generator into one buffer, honouring an abort signal. */
export async function collectBytes(
  chunks: AsyncIterable<Uint8Array>,
  expected: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  const out = new Uint8Array(expected)
  let offset = 0
  for await (const chunk of chunks) {
    throwIfAborted(signal)
    const take = Math.min(chunk.length, expected - offset)
    out.set(chunk.subarray(0, take), offset)
    offset += take
    if (offset >= expected) break
  }
  return offset === expected ? out : out.subarray(0, offset)
}

/** Drain an async `Float64Array` generator (phaseModulate) into one buffer. */
export async function collectPhases(
  chunks: AsyncIterable<Float64Array>,
  expected: number,
  signal?: AbortSignal,
): Promise<Float64Array> {
  const out = new Float64Array(expected)
  let offset = 0
  for await (const chunk of chunks) {
    throwIfAborted(signal)
    const take = Math.min(chunk.length, expected - offset)
    out.set(chunk.subarray(0, take), offset)
    offset += take
    if (offset >= expected) break
  }
  return offset === expected ? out : out.subarray(0, offset)
}

/**
 * Check that XOR by a per-ring constant only *permutes* each ring's byte
 * histogram: for ring k, imprinted value `v ^ mask[k]` must occur exactly as
 * often as original value `v`. Returns the number of violations (0 = exact).
 */
export function ringPermutationMismatches(
  original: ArrayLike<number>,
  imprinted: ArrayLike<number>,
  mask: ArrayLike<number>,
): number {
  const rings = mask.length
  const before: Uint32Array[] = []
  const after: Uint32Array[] = []
  for (let k = 0; k < rings; k++) {
    before.push(new Uint32Array(256))
    after.push(new Uint32Array(256))
  }
  for (let i = 0; i < original.length; i++) {
    const k = i % rings
    ;(before[k] as Uint32Array)[(original[i] as number) & 0xff]++
    ;(after[k] as Uint32Array)[(imprinted[i] as number) & 0xff]++
  }
  let mismatches = 0
  for (let k = 0; k < rings; k++) {
    const m = (mask[k] as number) & 0xff
    const b = before[k] as Uint32Array
    const a = after[k] as Uint32Array
    for (let v = 0; v < 256; v++) {
      if ((b[v] as number) !== (a[v ^ m] as number)) mismatches++
    }
  }
  return mismatches
}
