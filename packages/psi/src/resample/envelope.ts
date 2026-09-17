import { PsiError } from '../errors.js'
import { assertOpenInterval } from '../internal/validate.js'

/** Options for {@link globalRankEnvelope}. */
export interface GlobalEnvelopeOptions {
  /** Global significance level. Default 0.05; needs $\alpha(s+1) \ge 1$. */
  alpha?: number
  /**
   * Which curve values count as extreme: `'two.sided'` (default) ranks from
   * both ends, `'greater'` only large values, `'less'` only small ones.
   */
  alternative?: 'two.sided' | 'greater' | 'less'
}

/** The global extreme-rank envelope test — see {@link globalRankEnvelope}. */
export interface GlobalRankEnvelope {
  readonly alpha: number
  readonly alternative: 'two.sided' | 'greater' | 'less'
  /** Simulated curves $s$. */
  readonly simulations: number
  /** Points per curve $d$. */
  readonly points: number
  /** Extreme rank $R_1$ of the observed curve (smaller = more extreme). */
  readonly rank: number
  /** Extreme ranks of all $s+1$ curves, observed first. */
  readonly ranks: Int32Array
  /**
   * The rank test's p-interval $[p_-, p_+]$ (ties among extreme ranks make
   * the p ambiguous): $p_- = \big(1 + \#\{i \ge 2 : R_i < R_1\}\big)/(s+1)$,
   * $p_+ = \#\{i \ge 1 : R_i \le R_1\}/(s+1)$. Report $p_+$ (conservative).
   */
  readonly pInterval: readonly [number, number]
  /**
   * Extreme-rank-length p: ties in $R_i$ broken by comparing each curve's
   * pointwise ranks sorted ascending, lexicographically; nearly exact for
   * continuous curves.
   */
  readonly pErl: number
  /** $k_\alpha$: the largest $k$ with $\#\{i : R_i < k\} \le \alpha(s+1)$. */
  readonly kAlpha: number
  /** $100(1-\alpha)\%$ global envelope: pointwise $k_\alpha$-th smallest of all $s+1$ curves (−∞ for `'greater'`). */
  readonly lower: Float64Array
  /** Pointwise $k_\alpha$-th largest of all $s+1$ curves (+∞ for `'less'`). */
  readonly upper: Float64Array
  /** The observed curve leaves the envelope somewhere — equivalent to $p_+ \le \alpha$. */
  readonly outside: boolean
}

function validate(observed: ArrayLike<number>, simulated: readonly ArrayLike<number>[]): number {
  const d = observed?.length
  if (typeof d !== 'number' || d < 1) {
    throw new PsiError('invalid_plan', 'observed curve must be a non-empty array')
  }
  if (!Array.isArray(simulated as unknown) || simulated.length === 0) {
    throw new PsiError('insufficient_data', 'globalRankEnvelope needs at least one simulated curve')
  }
  const curves = [observed, ...simulated]
  curves.forEach((curve, i) => {
    if (curve?.length !== d) {
      throw new PsiError(
        'invalid_plan',
        `simulated curve ${i - 1} has ${curve?.length} points, observed has ${d}`,
      )
    }
    for (let r = 0; r < d; r++) {
      if (!Number.isFinite(curve[r])) {
        const which = i === 0 ? 'observed curve' : `simulated curve ${i - 1}`
        throw new PsiError('invalid_plan', `${which} point ${r} is not finite: ${curve[r]}`)
      }
    }
  })
  return d
}

/** Lexicographic comparison of two ascending-sorted rank vectors. */
function compareSorted(a: Int32Array, b: Int32Array): number {
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] as number) - (b[i] as number)
    if (diff !== 0) return diff
  }
  return 0
}

/**
 * Global extreme-rank envelope test (Myllymäki, Mrkvička, Grabarnik, Seijo &
 * Hahn 2017, "Global envelope tests for spatial processes", JRSS-B 79:381)
 * for a functional statistic — a cumulative-deviation trace, a rolling
 * z curve, an L-function — against $s$ curves simulated under H0 (e.g. from
 * {@link timeOffsetSurrogates}, {@link placeboWindows}, or a seeded null).
 *
 * For each point $r$ the pointwise ranks of the $s+1$ curves are counted with
 * ties treated as *not* more extreme: from below $\#\{j : T_j(r) \le T_i(r)\}$,
 * from above $\#\{j : T_j(r) \ge T_i(r)\}$; the two-sided pointwise rank is the
 * smaller. A curve's extreme rank is $R_i = \min_r$ of its pointwise ranks.
 * The envelope at $k_\alpha$ contains the observed curve everywhere iff
 * $p_+ > \alpha$, so unlike a pointwise band it has a *global* type-I error
 * $\le \alpha$ over the whole curve. Myllymäki et al. recommend
 * $s \ge 2499$ at $\alpha = 0.05$ for a stable envelope.
 *
 * Deterministic; memory $O(d \cdot s)$ — thin long curves before calling.
 *
 * @throws {PsiError} `invalid_plan` (length mismatch, non-finite values, bad
 *   options), `insufficient_data` (no simulations, or $\alpha(s+1) < 1$).
 */
export function globalRankEnvelope(
  observed: ArrayLike<number>,
  simulated: readonly ArrayLike<number>[],
  opts: GlobalEnvelopeOptions = {},
): GlobalRankEnvelope {
  const alpha = assertOpenInterval(opts.alpha ?? 0.05, 0, 1, 'alpha')
  const alternative = opts.alternative ?? 'two.sided'
  if (alternative !== 'two.sided' && alternative !== 'greater' && alternative !== 'less') {
    throw new PsiError('invalid_plan', `alternative must be 'two.sided', 'greater', or 'less'`)
  }
  const d = validate(observed, simulated)
  const n = simulated.length + 1
  const budget = alpha * n
  if (budget < 1 - 1e-9) {
    throw new PsiError(
      'insufficient_data',
      `alpha ${alpha} needs at least ${Math.ceil(1 / alpha) - 1} simulations, got ${n - 1}`,
    )
  }
  const curves = [observed, ...simulated]
  const pointwise = Array.from({ length: n }, () => new Int32Array(d))
  const order = Array.from({ length: n }, (_, i) => i)
  const column = new Float64Array(n)
  for (let r = 0; r < d; r++) {
    for (let i = 0; i < n; i++) column[i] = (curves[i] as ArrayLike<number>)[r] as number
    order.sort((a, b) => (column[a] as number) - (column[b] as number))
    let start = 0
    while (start < n) {
      let end = start
      while (end + 1 < n && column[order[end + 1] as number] === column[order[start] as number])
        end++
      const below = end + 1
      const above = n - start
      for (let p = start; p <= end; p++) {
        const rank =
          alternative === 'greater'
            ? above
            : alternative === 'less'
              ? below
              : Math.min(below, above)
        ;(pointwise[order[p] as number] as Int32Array)[r] = rank
      }
      start = end + 1
    }
  }
  const ranks = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const p = pointwise[i] as Int32Array
    let min = Number.POSITIVE_INFINITY
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
  const sortedRanks = Int32Array.from(ranks).sort()
  let kAlpha = 1
  let below = 0 // #{i : R_i < k} for the candidate k
  for (let k = 2; k <= n; k++) {
    while (below < n && (sortedRanks[below] as number) < k) below++
    if (below > budget + 1e-9) break
    kAlpha = k
  }
  // extreme rank length: sort each curve's pointwise ranks, compare lexicographically
  for (const p of pointwise) p.sort()
  const reference = pointwise[0] as Int32Array
  let erlAtMost = 0
  for (let i = 0; i < n; i++) {
    // E_i ≤ E_1 ⟺ curve i is at least as extreme as the observed one
    if (compareSorted(pointwise[i] as Int32Array, reference) <= 0) erlAtMost++
  }
  const lower = new Float64Array(d)
  const upper = new Float64Array(d)
  const k = kAlpha
  for (let r = 0; r < d; r++) {
    for (let i = 0; i < n; i++) column[i] = (curves[i] as ArrayLike<number>)[r] as number
    const sorted = Float64Array.from(column).sort()
    lower[r] = alternative === 'greater' ? Number.NEGATIVE_INFINITY : (sorted[k - 1] as number)
    upper[r] = alternative === 'less' ? Number.POSITIVE_INFINITY : (sorted[n - k] as number)
  }
  let outside = false
  for (let r = 0; r < d && !outside; r++) {
    const x = observed[r] as number
    outside = x < (lower[r] as number) || x > (upper[r] as number)
  }
  return Object.freeze({
    alpha,
    alternative,
    simulations: n - 1,
    points: d,
    rank: r1,
    ranks,
    pInterval: Object.freeze([(1 + less) / n, atMost / n] as [number, number]),
    pErl: erlAtMost / n,
    kAlpha,
    lower,
    upper,
    outside,
  })
}
