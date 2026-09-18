// Exact reference numbers the oracle page prints next to empirical ones.
// Pure arithmetic — no SDK import, so this module is SSR-safe on its own; it is
// only ever imported from client components.

/**
 * A number input's value, made safe for arithmetic: a cleared `UInputNumber`
 * hands back `undefined` or `NaN`, which would otherwise poison every derived
 * chart. Non-numbers fall back; numbers are clamped.
 */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Bytes per `uniformInt` attempt: ⌈log₂₅₆ n⌉. */
export function attemptBytes(n: number): number {
  let k = 1
  let range = 256
  while (range < n) {
    k++
    range *= 256
  }
  return k
}

/** Acceptance probability α = ⌊256ᵏ/n⌋·n / 256ᵏ — always > 1/2. */
export function acceptance(n: number): number {
  if (n <= 1) return 1
  const range = 256 ** attemptBytes(n)
  return (Math.floor(range / n) * n) / range
}

/** Expected bytes of one `uniformInt(n)`: k/α (0 for n = 1). */
export function expectedUniformBytes(n: number): number {
  if (n <= 1) return 0
  return attemptBytes(n) / acceptance(n)
}

/**
 * The exact distribution of the naive `byte % n` mapping for n ≤ 256:
 * residue r is hit by ⌈(256 − r)/n⌉ of the 256 byte values.
 */
export function naiveModuloProbs(n: number): number[] {
  const out = new Array<number>(n).fill(0)
  for (let v = 0; v < 256; v++) out[v % n] = (out[v % n] as number) + 1 / 256
  return out
}

/** How much more likely the favoured residues are under `byte % n` (exact). */
export function naiveBiasRatio(n: number): number {
  const probs = naiveModuloProbs(n)
  let min = Number.POSITIVE_INFINITY
  let max = 0
  for (const p of probs) {
    if (p < min) min = p
    if (p > max) max = p
  }
  return min > 0 ? max / min : Number.POSITIVE_INFINITY
}

/** How many residues share the highest naive probability. */
export function naiveFavoured(n: number): number {
  const probs = naiveModuloProbs(n)
  const max = Math.max(...probs)
  return probs.filter((p) => p === max).length
}

/** Ordered deals n·(n−1)···(n−count+1) — exact, so BigInt. */
export function orderedDeals(n: number, count: number): bigint {
  let product = 1n
  for (let i = 0; i < count; i++) product *= BigInt(n - i)
  return product
}

/** A huge exact integer as `1.23e+18` (or plain digits while it is short). */
export function fmtBig(value: bigint, digits = 2): string {
  const text = value.toString()
  if (text.length <= 7) return Number(value).toLocaleString('en-US')
  return `${text[0]}.${text.slice(1, 1 + digits)}e+${text.length - 1}`
}

/** `1/16`, `5/16`, … for a weight table. */
export function fraction(weight: number, total: number): string {
  return `${weight}/${total}`
}

/** Binomial coefficient C(n, k) for small n (exact in float64 up to n = 64). */
export function binomial(n: number, k: number): number {
  let c = 1
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1)
  return Math.round(c)
}
