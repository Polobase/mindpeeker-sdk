import { FieldError } from '../errors.js'

/** Global extreme-rank envelope test result (Myllymäki et al. 2017). */
export interface RankEnvelopeTest {
  /** Extreme rank $R_1$ of the observed curve among all $s+1$ curves (smaller = more extreme). */
  readonly rank: number
  /**
   * The rank test's p-interval $[p_-, p_+]$ — ties among extreme ranks make
   * the p ambiguous: $p_- = (1 + \#\{i \ge 2: R_i < R_1\})/(s+1)$,
   * $p_+ = \#\{i: R_i \le R_1\}/(s+1)$.
   */
  readonly pInterval: readonly [number, number]
  /** Extreme-rank-length p (ties broken lexicographically by sorted pointwise ranks) — the reported p. */
  readonly p: number
  /** Global significance level of `lower`/`upper`. */
  readonly alpha: number
  /**
   * $100(1-\alpha)\%$ global envelope: pointwise $k_\alpha$-th smallest of the
   * $s+1$ curves, $k_\alpha$ the largest $k$ with $\#\{i: R_i < k\} \le \alpha(s+1)$.
   * `undefined` when $\alpha(s+1) < 1$ (too few runs).
   */
  readonly lower: Float64Array | undefined
  /** Pointwise $k_\alpha$-th largest of the $s+1$ curves (see `lower`). */
  readonly upper: Float64Array | undefined
}

/** Maximum absolute deviation (MAD) global test (Diggle 1979; Baddeley et al. 2014). */
export interface MadTest {
  /** $T_1 = \max_r |c_1(r) - \bar c(r)|$ for the observed curve. */
  readonly statistic: number
  /** $\#\{i : T_i \ge T_1\}/(s+1)$. */
  readonly p: number
}

/** Pointwise two-sided ranks, ties counted as *not* more extreme. */
function pointwiseRanks(curves: readonly Float64Array[], d: number): Int32Array[] {
  const n = curves.length
  const ranks = Array.from({ length: n }, () => new Int32Array(d))
  const order = Array.from({ length: n }, (_, i) => i)
  const column = new Float64Array(n)
  for (let r = 0; r < d; r++) {
    for (let i = 0; i < n; i++) column[i] = (curves[i] as Float64Array)[r] as number
    order.sort((a, b) => (column[a] as number) - (column[b] as number))
    let start = 0
    while (start < n) {
      let end = start
      while (end + 1 < n && column[order[end + 1] as number] === column[order[start] as number]) {
        end++
      }
      const rank = Math.min(end + 1, n - start)
      for (let q = start; q <= end; q++) (ranks[order[q] as number] as Int32Array)[r] = rank
      start = end + 1
    }
  }
  return ranks
}

function compareSorted(a: Int32Array, b: Int32Array): number {
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] as number) - (b[i] as number)
    if (diff !== 0) return diff
  }
  return 0
}

/** Reject non-finite curve values (e.g. border-corrected K with no eligible centre). */
export function checkCurves(curves: readonly Float64Array[], radii: Float64Array): void {
  for (let i = 0; i < curves.length; i++) {
    const c = curves[i] as Float64Array
    for (let k = 0; k < c.length; k++) {
      if (!Number.isFinite(c[k])) {
        const which = i === 0 ? 'the observed curve' : `simulation ${i - 1}`
        throw new FieldError(
          'insufficient_data',
          `${which} is undefined at radius ${radii[k]} (border method with no eligible centre?)`,
        )
      }
    }
  }
}

/**
 * Two-sided global tests of the observed curve `curves[0]` against the
 * simulated `curves[1..s]`: the extreme-rank envelope with its ERL p
 * (Myllymäki, Mrkvička, Grabarnik, Seijo & Hahn 2017, JRSS-B 79:381) and the
 * MAD test with the reference curve $\bar c$ = pointwise mean of all $s+1$
 * curves (a symmetric function of the curves, so the Monte-Carlo test stays
 * exact). Also returns the pointwise two-sided rank p per radius,
 * $\min(1, 2\min(\#\{T_j \le T_1\}, \#\{T_j \ge T_1\})/(s+1))$.
 */
export function globalTests(
  curves: readonly Float64Array[],
  alpha: number,
): { rank: RankEnvelopeTest; mad: MadTest; pointwiseP: Float64Array } {
  const n = curves.length
  const d = (curves[0] as Float64Array).length
  const pointwise = pointwiseRanks(curves, d)
  const ranks = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const p = pointwise[i] as Int32Array
    let min = n
    for (let r = 0; r < d; r++) min = Math.min(min, p[r] as number)
    ranks[i] = min
  }
  const r1 = ranks[0] as number
  let less = 0
  let atMost = 0
  for (let i = 0; i < n; i++) {
    if (i > 0 && (ranks[i] as number) < r1) less++
    if ((ranks[i] as number) <= r1) atMost++
  }
  const pointwiseP = new Float64Array(d)
  const observedRanks = pointwise[0] as Int32Array
  for (let r = 0; r < d; r++) {
    pointwiseP[r] = Math.min(1, (2 * (observedRanks[r] as number)) / n)
  }
  const sortedRanks = Int32Array.from(ranks).sort()
  const budget = alpha * n
  let kAlpha = 0
  if (budget >= 1 - 1e-9) {
    kAlpha = 1
    let below = 0
    for (let k = 2; k <= n; k++) {
      while (below < n && (sortedRanks[below] as number) < k) below++
      if (below > budget + 1e-9) break
      kAlpha = k
    }
  }
  let lower: Float64Array | undefined
  let upper: Float64Array | undefined
  if (kAlpha >= 1) {
    lower = new Float64Array(d)
    upper = new Float64Array(d)
    const column = new Float64Array(n)
    for (let r = 0; r < d; r++) {
      for (let i = 0; i < n; i++) column[i] = (curves[i] as Float64Array)[r] as number
      column.sort()
      lower[r] = column[kAlpha - 1] as number
      upper[r] = column[n - kAlpha] as number
    }
  }
  for (const p of pointwise) p.sort()
  const reference = pointwise[0] as Int32Array
  let erlAtMost = 0
  for (let i = 0; i < n; i++) {
    if (compareSorted(pointwise[i] as Int32Array, reference) <= 0) erlAtMost++
  }

  const mean = new Float64Array(d)
  for (const c of curves)
    for (let r = 0; r < d; r++) mean[r] = (mean[r] as number) + (c[r] as number)
  for (let r = 0; r < d; r++) mean[r] = (mean[r] as number) / n
  const deviation = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const c = curves[i] as Float64Array
    let max = 0
    for (let r = 0; r < d; r++)
      max = Math.max(max, Math.abs((c[r] as number) - (mean[r] as number)))
    deviation[i] = max
  }
  const t1 = deviation[0] as number
  let madAtLeast = 0
  for (let i = 0; i < n; i++) if ((deviation[i] as number) >= t1) madAtLeast++

  return {
    rank: Object.freeze({
      rank: r1,
      pInterval: Object.freeze([(1 + less) / n, atMost / n] as const),
      p: erlAtMost / n,
      alpha,
      lower,
      upper,
    }),
    mad: Object.freeze({ statistic: t1, p: madAtLeast / n }),
    pointwiseP,
  }
}
