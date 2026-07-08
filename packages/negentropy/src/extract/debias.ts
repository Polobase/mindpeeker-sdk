import { NegentropyError } from '../errors.js'

/**
 * Von Neumann debiasing: consume bit pairs, 01→0, 10→1, 00/11 discarded.
 * Output is exactly unbiased WHEN INPUT BITS ARE IID — correlated input
 * yields biased output. Yield is pq ≤ 25%; a trailing unpaired bit is dropped.
 */
export function vonNeumann(bits: ArrayLike<number>): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < bits.length; i += 2) {
    const a = (bits[i] as number) & 1
    const b = (bits[i + 1] as number) & 1
    if (a !== b) out.push(a)
  }
  return out
}

/**
 * Peres iterated von Neumann (Peres 1992, Ann. Statist. 20(1)): recursively
 * recycles what von Neumann throws away — the pair-XOR sequence U and the
 * equal-pair values V — as Peres(x) = VN(x) ++ Peres(U) ++ Peres(V) (that
 * concatenation order is this implementation's frozen convention). Extraction
 * rate approaches the full Shannon entropy H(p) as depth grows, vs von
 * Neumann's pq ceiling. Same iid-input requirement as von Neumann.
 */
export function peres(bits: ArrayLike<number>, maxDepth = Number.POSITIVE_INFINITY): number[] {
  if (maxDepth !== Number.POSITIVE_INFINITY && (!Number.isInteger(maxDepth) || maxDepth < 1)) {
    throw new NegentropyError(
      'invalid_config',
      `maxDepth must be a positive integer, got ${maxDepth}`,
    )
  }
  const input = new Uint8Array(bits.length)
  for (let i = 0; i < bits.length; i++) input[i] = (bits[i] as number) & 1
  const out: number[] = []
  peresInto(input, maxDepth, out)
  return out
}

function peresInto(bits: Uint8Array, depth: number, out: number[]): void {
  if (bits.length < 2 || depth < 1) return
  const pairs = bits.length >> 1
  const u = new Uint8Array(pairs)
  const v: number[] = []
  for (let i = 0; i < pairs; i++) {
    const a = bits[2 * i] as number
    const b = bits[2 * i + 1] as number
    if (a !== b) out.push(a)
    u[i] = a ^ b
    if (a === b) v.push(a)
  }
  peresInto(u, depth - 1, out)
  peresInto(Uint8Array.from(v), depth - 1, out)
}

/**
 * Expected Peres output rate (bits out per bit in) at recursion depth d for
 * iid input bias p, via the exact recurrence
 * R₍d₊₁₎(p) = pq + ½·R_d(2pq) + ((p²+q²)/2)·R_d(p²/(p²+q²)), R₀ = 0.
 * R₁ = pq is von Neumann; R_d → H(p) as d → ∞. Exact values at p = ½:
 * ¼, 7/16, 37/64, … Cost is O(2^depth) — the recursion branches on distinct
 * biases — hence the depth ≤ 25 cap.
 */
export function peresRate(p: number, depth: number): number {
  if (!(p > 0 && p < 1)) {
    throw new NegentropyError('invalid_config', `bias p must be in (0, 1), got ${p}`)
  }
  if (!Number.isInteger(depth) || depth < 0 || depth > 25) {
    throw new NegentropyError(
      'invalid_config',
      `depth must be an integer in [0, 25] (cost grows as 2^depth), got ${depth}`,
    )
  }
  return rate(p, depth)
}

function rate(p: number, depth: number): number {
  // repeated p²/(p²+q²) mapping drives extreme biases to exactly 0 or 1 in
  // float64 — those branches are deterministic and carry zero extractable entropy
  if (depth === 0 || p <= 0 || p >= 1) return 0
  const q = 1 - p
  const equal = p * p + q * q
  return p * q + 0.5 * rate(2 * p * q, depth - 1) + (equal / 2) * rate((p * p) / equal, depth - 1)
}
