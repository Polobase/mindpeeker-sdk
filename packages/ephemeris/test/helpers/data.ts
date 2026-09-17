import type { LstLabelledTrial } from '../../src/index.js'

/** mulberry32: a tiny test-only generator, deliberately unrelated to the package PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normal deviates by Box–Muller. */
export function normal(random: () => number): () => number {
  return () => {
    const u = 1 - random()
    const v = random()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
}

/** Is LST `h` inside the half-open circular window of width `w` centred at `c`? */
export function inWindow(h: number, c: number, w: number): boolean {
  return (((h - c + w / 2) % 24) + 24) % 24 < w
}

/** Brute-force window means (independent of the prefix-sum implementation). */
export function bruteWindowMeans(
  trials: readonly { lstHours: number; effect: number }[],
  windowHours: number,
  stepHours: number,
): { center: number; n: number; mean: number | null }[] {
  const count = Math.round(24 / stepHours)
  const out: { center: number; n: number; mean: number | null }[] = []
  for (let j = 0; j < count; j++) {
    const c = (j * 24) / count
    const inside = trials.filter((t) => inWindow(t.lstHours, c, windowHours))
    const sum = inside.reduce((s, t) => s + t.effect, 0)
    out.push({ center: c, n: inside.length, mean: inside.length ? sum / inside.length : null })
  }
  return out
}

/** Uniform-LST trials with N(0, 1) effects plus `shift` inside `[lo, hi)`. */
export function syntheticTrials(
  n: number,
  seed: number,
  shift = 0,
  lo = 12.5,
  hi = 14.5,
): LstLabelledTrial[] {
  const random = mulberry32(seed)
  const gauss = normal(random)
  return Array.from({ length: n }, () => {
    const lstHours = random() * 24
    const bump = lstHours >= lo && lstHours < hi ? shift : 0
    return { lstHours, effect: gauss() + bump }
  })
}

/** Two-sided band [lo, hi] holding Binomial(n, p) with probability ≥ 1 − alpha (exact pmf sums). */
export function binomialBand(n: number, p: number, alpha: number): [number, number] {
  const logPmf = (k: number): number => {
    let lg = 0
    for (let i = 1; i <= n; i++) lg += Math.log(i)
    for (let i = 1; i <= k; i++) lg -= Math.log(i)
    for (let i = 1; i <= n - k; i++) lg -= Math.log(i)
    return lg + k * Math.log(p) + (n - k) * Math.log(1 - p)
  }
  const pmf = Array.from({ length: n + 1 }, (_, k) => Math.exp(logPmf(k)))
  let lo = 0
  let tail = 0
  while (tail + (pmf[lo] as number) <= alpha / 2) tail += pmf[lo++] as number
  let hi = n
  tail = 0
  while (tail + (pmf[hi] as number) <= alpha / 2) tail += pmf[hi--] as number
  return [lo, hi]
}
