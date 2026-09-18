// Synthetic contamination for the order-detection demos.
//
// The bits always come from the SDK provider the header selects; what the
// sliders control is how many of them get overwritten by a biased / sticky
// model, so a viewer can watch a passing battery start failing. The overwrite
// PATTERN comes from a small seeded xorshift PRNG — a slider position is
// therefore reproducible and is never counted as entropy.
//
// CLIENT-ONLY: imports @mindpeeker/negentropy.

import { toBits } from '@mindpeeker/negentropy'

/** How the raw bits are contaminated. Both zero ⇒ the bits pass through untouched. */
export interface MixSpec {
  /** One-bit excess b: a zero is flipped with probability 2b, so P(1) = 0.5 + b. */
  bias: number
  /** Lag-1 stickiness: probability that a bit is overwritten by its predecessor. */
  stickiness: number
  /** Seed of the overwrite pattern (not entropy). */
  seed?: number
}

export const NO_MIX: MixSpec = { bias: 0, stickiness: 0 }

/** True when the spec leaves the input bits exactly as they arrived. */
export function isClean(spec: MixSpec): boolean {
  return !(spec.bias > 0) && !(spec.stickiness > 0)
}

/** xorshift32 → uniform [0, 1). Deterministic, fast, and never used as entropy. */
export function uniformStream(seed: number): () => number {
  let state = (seed | 0) === 0 ? 0x9e3779b9 : seed | 0
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return ((state >>> 0) + 1) / 4294967297
  }
}

/** A stable 32-bit seed for a label, so each stream gets its own overwrite pattern. */
export function labelSeed(label: string, salt = 0): number {
  let hash = 0x811c9dc5 ^ salt
  for (let i = 0; i < label.length; i++) {
    hash ^= label.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash | 0
}

/**
 * Overwrite a fraction of the bits with a biased / sticky model.
 * Both uniforms are drawn for every bit whatever the branch takes, so the
 * pattern of one slider does not shift when the other moves.
 */
export function mixBits(bits: Uint8Array, spec: MixSpec): Uint8Array {
  if (isClean(spec)) return bits
  const next = uniformStream(spec.seed ?? 0x5bf03635)
  const flip = Math.min(1, Math.max(0, 2 * spec.bias))
  const stick = Math.min(1, Math.max(0, spec.stickiness))
  const out = new Uint8Array(bits.length)
  let previous = 0
  for (let i = 0; i < bits.length; i++) {
    const u1 = next()
    const u2 = next()
    let bit = bits[i] as number
    if (bit === 0 && u1 < flip) bit = 1
    if (i > 0 && u2 < stick) bit = previous
    out[i] = bit
    previous = bit
  }
  return out
}

/** Pack 0/1 bits MSB-first; a trailing partial byte is dropped. */
export function packBits(bits: ArrayLike<number>): Uint8Array {
  const count = Math.floor(bits.length / 8)
  const out = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    let value = 0
    for (let b = 0; b < 8; b++) value = (value << 1) | ((bits[i * 8 + b] as number) & 1)
    out[i] = value
  }
  return out
}

/** bytes → bits → contamination → bytes. */
export function mixBytes(bytes: Uint8Array, spec: MixSpec): Uint8Array {
  if (isClean(spec)) return bytes
  return packBits(mixBits(toBits(bytes), spec))
}

/** One line naming exactly what the sliders did to the bits. */
export function describeMix(spec: MixSpec): string {
  if (isClean(spec)) return 'raw bits, untouched'
  const parts: string[] = []
  if (spec.bias > 0) parts.push(`P(1) = ${(0.5 + spec.bias).toFixed(3)}`)
  if (spec.stickiness > 0) parts.push(`P(bit = previous bit) = ${spec.stickiness.toFixed(2)}`)
  return `synthetic contamination — ${parts.join(', ')}`
}

/** Independent Bernoulli(0.5 + bias) bits only — the debiaser demos' input model. */
export function biasedBytes(bytes: Uint8Array, bias: number, seed: number): Uint8Array {
  return mixBytes(bytes, { bias, stickiness: 0, seed })
}

/** Shannon entropy of a Bernoulli(p) bit — the rate ceiling of any debiaser. */
export function binaryEntropy(p: number): number {
  if (p <= 0 || p >= 1) return 0
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p)
}
