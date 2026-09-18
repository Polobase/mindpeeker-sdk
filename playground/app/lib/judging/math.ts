/**
 * Small pure helpers the judging page uses to *draw* what the SDK computes:
 * the binomial null a chart compares against, tail sums over a pmf the SDK
 * returned, and integer-only formatting for bigint counts.
 *
 * Nothing here re-implements a package function: every reported statistic and
 * p-value on the page comes from `@mindpeeker/judging` itself.
 */

/** log n! for n = 0…max, by cumulative summation (exact to ~1 ulp per term). */
function logFactorials(max: number): Float64Array {
  const out = new Float64Array(max + 1)
  for (let i = 1; i <= max; i++) out[i] = (out[i - 1] as number) + Math.log(i)
  return out
}

/**
 * Binomial(n, p) pmf over k = 0…n, in log space so tiny tails keep their
 * digits. This is the *open-deck* null a closed-deck chart is compared with.
 */
export function binomialPmf(n: number, p: number): Float64Array {
  const lf = logFactorials(n)
  const out = new Float64Array(n + 1)
  const lp = Math.log(p)
  const lq = Math.log1p(-p)
  for (let k = 0; k <= n; k++) {
    out[k] = Math.exp((lf[n] as number) - (lf[k] as number) - (lf[n - k] as number) + k * lp + (n - k) * lq)
  }
  return out
}

/** P(X ≥ from) over a pmf indexed from `offset`, summed from the top. */
export function upperTailOf(pmf: ArrayLike<number>, from: number, offset = 0): number {
  let sum = 0
  for (let i = pmf.length - 1; i >= from - offset; i--) sum += (pmf[i] as number) ?? 0
  return Math.min(1, Math.max(0, sum))
}

/** P(X ≤ to) over a pmf indexed from `offset`. */
export function lowerTailOf(pmf: ArrayLike<number>, to: number, offset = 0): number {
  let sum = 0
  for (let i = 0; i <= to - offset && i < pmf.length; i++) sum += (pmf[i] as number) ?? 0
  return Math.min(1, Math.max(0, sum))
}

/** Mean of a pmf indexed from `offset`. */
export function meanOf(pmf: ArrayLike<number>, offset = 0): number {
  let mean = 0
  for (let i = 0; i < pmf.length; i++) mean += (offset + i) * (pmf[i] as number)
  return mean
}

/** Trim a pmf to the range that carries visible mass, keeping the offset. */
export function visibleRange(pmf: ArrayLike<number>, floor = 1e-6): { from: number; to: number } {
  let from = 0
  let to = pmf.length - 1
  while (from < to && (pmf[from] as number) < floor) from++
  while (to > from && (pmf[to] as number) < floor) to--
  return { from, to }
}

/** Group digits of a bigint for display: 623360743125120 → '623 360 743 125 120'. */
export function groupBigInt(value: bigint): string {
  const text = value.toString()
  let out = ''
  for (let i = 0; i < text.length; i++) {
    if (i > 0 && (text.length - i) % 3 === 0) out += ' '
    out += text[i]
  }
  return out
}

/** Evenly spaced values in [from, to] (inclusive), `count` of them. */
export function linspace(from: number, to: number, count: number): Float64Array {
  const out = new Float64Array(count)
  const step = count > 1 ? (to - from) / (count - 1) : 0
  for (let i = 0; i < count; i++) out[i] = from + i * step
  return out
}

/** Integer sequence from..to inclusive. */
export function range(from: number, to: number, step = 1): number[] {
  const out: number[] = []
  for (let i = from; i <= to; i += step) out.push(i)
  return out
}

/**
 * Every pairing's score for a k × k judging matrix, by direct enumeration of
 * all k! permutations (k ≤ 8 here, so at most 40 320 sums).
 *
 * This is only for *drawing* the null: the p-value on the page comes from
 * `rankMatrixPermutationTest`, and the page prints both counts so they can be
 * compared.
 */
export function pairingSums(matrix: readonly (readonly number[])[]): Float64Array {
  const k = matrix.length
  let total = 1
  for (let i = 2; i <= k; i++) total *= i
  const out = new Float64Array(total)
  const used = new Array<boolean>(k).fill(false)
  let at = 0
  const visit = (row: number, partial: number): void => {
    if (row === k) {
      out[at++] = partial
      return
    }
    const values = matrix[row] as readonly number[]
    for (let column = 0; column < k; column++) {
      if (used[column]) continue
      used[column] = true
      visit(row + 1, partial + (values[column] as number))
      used[column] = false
    }
  }
  visit(0, 0)
  return out
}
