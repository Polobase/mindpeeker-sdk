/**
 * Displacement scoring: matching each call against the targets a few places
 * before or after its own (Soal & Goldney 1943; Carington 1940). Pooling
 * offsets changes the null variance, and choosing offsets after seeing the
 * data is a multiplicity problem — both are handled explicitly here.
 */
import { upperTail } from './internal/binomial.js'
import { normSf } from './internal/numerics.js'
import {
  invalidInput,
  invalidOptions,
  numberMatrix,
  optionInteger,
  optionsObject,
} from './internal/validate.js'

/** Largest convolution work {@link displacementScore} spends on the exact pooled p. */
export const MAX_DISPLACEMENT_WORK = 100_000_000

/** Options for {@link displacementScore}. */
export interface DisplacementOptions {
  /** Number of equiprobable target symbols $m$ (targets and calls are integers in `0…m−1`). */
  readonly choices: number
  /**
   * Offsets $d$ to score and pool: call $i$ is compared with target $i + d$
   * (so $d = +1$ scores a call against the *next* target — "precognitive"
   * displacement in Soal's terms). Distinct integers. Default `[-1, 0, 1]`.
   */
  readonly offsets?: readonly number[]
  /**
   * Length of one run (a record sheet); comparisons never cross run
   * boundaries. The last run may be shorter. Default: the whole sequence.
   */
  readonly runLength?: number
}

/** Score at one offset. */
export interface OffsetScore {
  readonly offset: number
  readonly comparisons: number
  readonly hits: number
  readonly expected: number
  /** Binomial SD — exact for a single offset, since each comparison uses a different target. */
  readonly sd: number
  readonly criticalRatio: number
  /** Exact binomial $P(X \ge \text{hits})$. */
  readonly pOneSided: number
}

/** Guess patterns grouped by the multiplicities of the calls compared with one target. */
export interface DisplacementPattern {
  /** Multiplicities of equal calls, descending, joined by `+` (e.g. `'2+1'` for AAB). */
  readonly signature: string
  /** Targets whose compared calls show this pattern. */
  readonly count: number
  /** Null variance of the hits on one such target, $\sum_s \mu_s^2/m - (\sum_s \mu_s/m)^2$. */
  readonly variance: number
}

/** Pooled displacement score with the pattern-exact variance. */
export interface DisplacementScore {
  readonly choices: number
  readonly offsets: readonly number[]
  readonly perOffset: readonly OffsetScore[]
  /** Comparisons over all pooled offsets. */
  readonly comparisons: number
  readonly hits: number
  readonly expected: number
  /** Exact null variance given the calls actually made (Bartlett's correction). */
  readonly variance: number
  /** The naive binomial variance `comparisons · p(1 − p)`, valid only for random-pattern calls. */
  readonly binomialVariance: number
  /** `(hits − expected) / √variance`. */
  readonly criticalRatio: number
  /** `(hits − expected) / √binomialVariance` — the uncorrected ratio, for comparison. */
  readonly binomialCriticalRatio: number
  /** $P(\text{pooled hits} \ge \text{hits})$: exact convolution, or the normal tail beyond the work limit. */
  readonly pOneSided: number
  readonly pMethod: 'exact' | 'normal'
  readonly patterns: readonly DisplacementPattern[]
}

/** One diagonal of a {@link displacementMatrix}. */
export interface DiagonalScore {
  /** Occasion minus original, $d = c - o$. */
  readonly offset: number
  readonly observed: number
  /** $E_d = \sum_{c-o=d} R_o C_c / T$. */
  readonly expected: number
  /** $(O_d - E_d)/\sqrt{E_d}$, or `null` when $E_d = 0$. */
  readonly z: number | null
}

function symbols(argument: string, value: unknown, m: number): number[] {
  if (!Array.isArray(value) || value.length === 0) {
    invalidInput(argument, `${argument} must be a non-empty array of symbols`)
  }
  return (value as unknown[]).map((x, i) => {
    if (typeof x !== 'number' || !Number.isInteger(x) || x < 0 || x >= m) {
      invalidInput(
        `${argument}[${i}]`,
        `${argument}[${i}] must be an integer in [0, ${m - 1}], got ${String(x)}`,
      )
    }
    return x
  })
}

/**
 * Score calls against targets at several displacements and pool them with the
 * variance that is actually correct for the calls made.
 *
 * Targets are assumed i.i.d. uniform over $m$ symbols (Soal's prepared random
 * numbers; not a closed pack). For a single offset the hits are
 * Binomial(comparisons, 1/m). Pooled offsets reuse each target: target $t$ is
 * compared with the calls $\{g_{t-d}\}$, and its hit count is
 * $X_t = \mu_t(T_t)$, the number of those calls equal to the target, so
 * $$\operatorname{Var} X_t = \frac{1}{m}\sum_s \mu_t(s)^2 - \Bigl(\frac{1}{m}\sum_s \mu_t(s)\Bigr)^2.$$
 * Targets are independent, so the pooled variance is $\sum_t \operatorname{Var} X_t$
 * — for $m = 5$: AAA 36/25, AAB 16/25, ABC 6/25, and at run ends AA 16/25,
 * AB 6/25. Bartlett's objection and Soal's reply (Proc. SPR 48) turn on
 * exactly this: the binomial $73 \cdot 4N/25$ holds only for random-pattern
 * calling. The exact pooled tail convolves the per-target distributions.
 *
 * The offsets must be fixed before the data are seen: picking the best of
 * several displacements afterwards raises the expected score (5 → 6.74 for
 * three looks at a Zener run; `expectedMaxOfPmf`). Soal's own data were
 * later shown to have been manipulated (Markwick 1978); what is encoded here
 * is the design and its null, not his results.
 *
 * @throws {JudgingError} `invalid_input` for unequal lengths or symbols
 *   outside `0…m−1`; `invalid_options` for `choices` < 2, duplicate or
 *   non-integer offsets, an offset as long as a run, or a bad `runLength`.
 */
export function displacementScore(
  targets: readonly number[],
  calls: readonly number[],
  options: DisplacementOptions,
): DisplacementScore {
  const opts = optionsObject(options)
  const m = optionInteger('choices', opts.choices, 2)
  const t = symbols('targets', targets, m)
  const g = symbols('calls', calls, m)
  if (g.length !== t.length) {
    invalidInput('calls', `calls (${g.length}) and targets (${t.length}) must have the same length`)
  }
  const n = t.length
  const runLength = opts.runLength === undefined ? n : optionInteger('runLength', opts.runLength, 1)
  const offsets = (opts.offsets ?? [-1, 0, 1]).map((d, i) =>
    optionInteger(`offsets[${i}]`, d, -(runLength - 1), runLength - 1),
  )
  if (offsets.length === 0 || new Set(offsets).size !== offsets.length) {
    invalidOptions('offsets', 'offsets must be a non-empty list of distinct integers')
  }
  const p = 1 / m
  const perOffset = offsets.map((d): OffsetScore => {
    let comparisons = 0
    let hits = 0
    for (let i = 0; i < n; i++) {
      const j = i + d
      if (j < 0 || j >= n || Math.floor(i / runLength) !== Math.floor(j / runLength)) continue
      comparisons++
      if (g[i] === t[j]) hits++
    }
    const expected = comparisons * p
    const sd = Math.sqrt(comparisons * p * (1 - p))
    return Object.freeze({
      offset: d,
      comparisons,
      hits,
      expected,
      sd,
      criticalRatio: sd > 0 ? (hits - expected) / sd : 0,
      pOneSided: comparisons > 0 ? upperTail(hits, comparisons, p) : 1,
    })
  })

  // per-target groups of compared calls
  const patternMap = new Map<string, { count: number; variance: number }>()
  const pmfs: Float64Array[] = []
  let variance = 0
  let hits = 0
  let comparisons = 0
  for (let target = 0; target < n; target++) {
    const multiplicity = new Map<number, number>()
    let size = 0
    for (const d of offsets) {
      const i = target - d
      if (i < 0 || i >= n || Math.floor(i / runLength) !== Math.floor(target / runLength)) continue
      const call = g[i] as number
      multiplicity.set(call, (multiplicity.get(call) ?? 0) + 1)
      size++
      if (call === t[target]) hits++
    }
    if (size === 0) continue
    comparisons += size
    let sumSquares = 0
    const pmf = new Float64Array(size + 1)
    pmf[0] = (m - multiplicity.size) / m
    for (const mu of multiplicity.values()) {
      sumSquares += mu * mu
      pmf[mu] = (pmf[mu] as number) + p
    }
    const v = sumSquares / m - (size / m) ** 2
    variance += v
    pmfs.push(pmf)
    const signature = [...multiplicity.values()].sort((a, b) => b - a).join('+')
    const entry = patternMap.get(signature)
    if (entry === undefined) patternMap.set(signature, { count: 1, variance: v })
    else entry.count++
  }

  const expected = comparisons * p
  const binomialVariance = comparisons * p * (1 - p)
  let work = 0
  let support = 1
  for (const pmf of pmfs) {
    work += support * pmf.length
    support += pmf.length - 1
  }
  let pOneSided: number
  let pMethod: 'exact' | 'normal'
  if (work <= MAX_DISPLACEMENT_WORK) {
    let dist = new Float64Array([1])
    for (const pmf of pmfs) {
      const next = new Float64Array(dist.length + pmf.length - 1)
      for (let i = 0; i < dist.length; i++) {
        const a = dist[i] as number
        if (a === 0) continue
        for (let j = 0; j < pmf.length; j++)
          next[i + j] = (next[i + j] as number) + a * (pmf[j] as number)
      }
      dist = next
    }
    let tail = 0
    for (let i = dist.length - 1; i >= hits; i--) tail += dist[i] as number
    pOneSided = Math.min(1, tail)
    pMethod = 'exact'
  } else {
    pOneSided = normSf((hits - 0.5 - expected) / Math.sqrt(variance))
    pMethod = 'normal'
  }
  const deviation = hits - expected
  return Object.freeze({
    choices: m,
    offsets: Object.freeze(offsets),
    perOffset: Object.freeze(perOffset),
    comparisons,
    hits,
    expected,
    variance,
    binomialVariance,
    criticalRatio: variance > 0 ? deviation / Math.sqrt(variance) : 0,
    binomialCriticalRatio: binomialVariance > 0 ? deviation / Math.sqrt(binomialVariance) : 0,
    pOneSided,
    pMethod,
    patterns: Object.freeze(
      [...patternMap.entries()]
        .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
        .map(([signature, e]) =>
          Object.freeze({ signature, count: e.count, variance: e.variance }),
        ),
    ),
  })
}

/**
 * Carington's (1940) diagonal analysis of an originals × occasions hit table
 * (e.g. drawings judged against every night's responses). With row totals
 * $R_o$, column totals $C_c$ and grand total $T$, the hits expected on the
 * displacement diagonal $d = c - o$ if matches were unrelated to timing are
 * $$E_d = \sum_{c - o = d} \frac{R_o C_c}{T},$$
 * compared with the observed $O_d$ as $(O_d - E_d)/\sqrt{E_d}$. The
 * diagonals are neither independent nor few: reading the largest z as
 * significant needs a multiplicity correction registered in advance
 * (`deflatedCriticalValue`).
 *
 * @throws {JudgingError} `invalid_input` for a ragged matrix, negative or
 *   non-finite entries, or a table with no hits.
 */
export function displacementMatrix(hits: readonly (readonly number[])[]): readonly DiagonalScore[] {
  const rows = numberMatrix('hits', hits)
  const r = rows.length
  const c = (rows[0] as number[]).length
  const rowTotals = new Float64Array(r)
  const columnTotals = new Float64Array(c)
  let total = 0
  rows.forEach((row, o) => {
    row.forEach((x, j) => {
      if (x < 0) invalidInput(`hits[${o}][${j}]`, `hits must be ≥ 0, got ${x}`)
      rowTotals[o] = (rowTotals[o] as number) + x
      columnTotals[j] = (columnTotals[j] as number) + x
      total += x
    })
  })
  if (!(total > 0)) invalidInput('hits', 'the table must contain at least one hit')
  const out: DiagonalScore[] = []
  for (let d = -(r - 1); d <= c - 1; d++) {
    let observed = 0
    let expected = 0
    for (let o = Math.max(0, -d); o < r && o + d < c; o++) {
      observed += (rows[o] as number[])[o + d] as number
      expected += ((rowTotals[o] as number) * (columnTotals[o + d] as number)) / total
    }
    out.push(
      Object.freeze({
        offset: d,
        observed,
        expected,
        z: expected > 0 ? (observed - expected) / Math.sqrt(expected) : null,
      }),
    )
  }
  return Object.freeze(out)
}
