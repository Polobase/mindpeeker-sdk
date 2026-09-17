import { PsiError } from '../errors.js'
import { type Seed, Xoshiro128 } from '../internal/prng.js'
import { assertInteger } from '../internal/validate.js'
import type { TrialSeries } from '../types.js'
import { DEFAULT_SURROGATES } from './label-shuffle.js'

export type { LabelShuffleDescription, LabelShuffleOptions } from './label-shuffle.js'
export {
  DEFAULT_SURROGATES,
  describeLabelShuffle,
  labelShuffleSurrogates,
} from './label-shuffle.js'

/** Options for {@link timeOffsetSurrogates}. */
export interface SurrogateOptions {
  /**
   * Which sources rotate:
   * - `'one'` (default, the 0.1.x behaviour) — only `sourceIndex` rotates.
   *   Tests "source $i$ is independent of the rest": with $N \ge 3$ sources the
   *   $(N-1)(N-2)/2$ pairs not involving source $i$ keep their true alignment in
   *   every surrogate, so a network-wide effect largely survives into the null
   *   (valid false-positive rate, low power).
   * - `'all-but-one'` — every source except the reference `sourceIndex`
   *   rotates by its own offset, pairwise distinct within each surrogate, so
   *   every source pair is misaligned (offsets from `design`).
   * - `'all'` — the GCP pseudo-event convention: every source rotates by the
   *   *same* offset, i.e. the analysis window is shifted over the whole
   *   (circularly wrapped) recording with all sources together.
   */
  rotate?: 'one' | 'all-but-one' | 'all'
  /** `'one'`: the rotated source; `'all-but-one'`: the fixed reference. Default 0. */
  sourceIndex?: number
  /**
   * `'one'` and `'all'`: explicit circular offsets in trials. Each must be an
   * integer nonzero modulo the series length (a zero rotation is the observed data).
   */
  offsets?: readonly number[]
  /**
   * Explicit per-surrogate offset vectors, one integer per source (aligned with
   * `seriesBySource`); overrides `rotate`. A vector whose entries are all equal
   * modulo $T$ is rejected — that is a common shift, not a misalignment
   * (use `rotate: 'all'` for pseudo-events).
   */
  sourceOffsets?: readonly (readonly number[])[]
  /**
   * `'all-but-one'` offset design. `'random'` (default): for each surrogate
   * draw $N-1$ distinct offsets uniformly from $\{1,\dots,T-1\}$ (seeded,
   * sampling without replacement). `'latin'`: deterministic cyclic design —
   * surrogate $j$ uses a multiplier $g_j$ coprime to $T$ and the $r$-th rotated
   * source gets $r \cdot g_j \bmod T$, pairwise distinct whenever $N \le T$ (for
   * prime $T$ the rows of the classic cyclic Latin-square construction).
   */
  design?: 'random' | 'latin'
  /** `design: 'random'` PRNG seed — part of the pre-registration. Default `0`. */
  seed?: Seed
  /**
   * Surrogates to generate. `'one'`/`'all'` (evenly spaced offsets
   * $\mathrm{round}\big(\tfrac{(i+1)\,T}{c+1}\big)$, deduplicated) default to
   * $\min(T-1, 100)$; `'all-but-one'` defaults to 100 (fewer when the latin
   * design runs out of multipliers). p resolution is $1/(m+1)$.
   */
  surrogates?: number
  /** @deprecated Alias of `surrogates` (0.1.x name). */
  count?: number
}

/** One surrogate dataset: the rotations applied and the resulting series. */
export interface Surrogate {
  /**
   * Offset of the first rotated source in trials (positive = shifted
   * earlier): the rotated source in `'one'`, the common offset in `'all'`,
   * the lowest-index rotated source otherwise.
   */
  readonly offset: number
  /** Per-source offsets aligned with the input (0 = unrotated, shared by reference). */
  readonly offsets: readonly number[]
  /** The input series with each rotated source replaced; timestamps stay in place. */
  readonly series: readonly TrialSeries[]
}

function normalize(offset: number, steps: number, what: string): number {
  if (!Number.isInteger(offset)) {
    throw new PsiError('invalid_plan', `${what} must be integers, got ${offset}`)
  }
  return ((offset % steps) + steps) % steps
}

function requestedCount(opts: SurrogateOptions): number | undefined {
  if (opts.surrogates !== undefined && opts.count !== undefined && opts.surrogates !== opts.count) {
    throw new PsiError('invalid_plan', 'surrogates and its deprecated alias count disagree')
  }
  const count = opts.surrogates ?? opts.count
  return count === undefined ? undefined : assertInteger(count, 1, 'surrogates')
}

function scalarOffsets(steps: number, opts: SurrogateOptions): number[] {
  if (opts.offsets !== undefined) {
    if (opts.offsets.length === 0) throw new PsiError('invalid_plan', 'offsets must not be empty')
    return opts.offsets.map((offset) => {
      const normalized = normalize(offset, steps, 'offsets')
      if (normalized === 0) {
        throw new PsiError(
          'invalid_plan',
          `offset ${offset} is zero modulo ${steps} steps — that is the observed data, not a surrogate`,
        )
      }
      return normalized
    })
  }
  const capped = Math.min(requestedCount(opts) ?? DEFAULT_SURROGATES, steps - 1)
  const offsets: number[] = []
  for (let i = 0; i < capped; i++) {
    const offset = Math.min(Math.max(Math.round(((i + 1) * steps) / (capped + 1)), 1), steps - 1)
    if (offsets[offsets.length - 1] !== offset) offsets.push(offset)
  }
  return offsets
}

function gcd(a: number, b: number): number {
  let x = a
  let y = b
  while (y !== 0) [x, y] = [y, x % y]
  return x
}

/** Offset vectors for rotate: 'all-but-one' (reference source fixed at 0). */
function allButOneVectors(
  n: number,
  steps: number,
  reference: number,
  opts: SurrogateOptions,
): number[][] {
  if (n < 2) {
    throw new PsiError('invalid_plan', "rotate: 'all-but-one' needs at least two series")
  }
  if (steps < n) {
    throw new PsiError(
      'insufficient_data',
      `rotate: 'all-but-one' needs at least ${n} trials for pairwise-distinct offsets, got ${steps}`,
    )
  }
  const count = requestedCount(opts) ?? DEFAULT_SURROGATES
  const design = opts.design ?? 'random'
  const vectors: number[][] = []
  const place = (rotated: readonly number[]): number[] => {
    const vector = new Array<number>(n).fill(0)
    let r = 0
    for (let i = 0; i < n; i++) if (i !== reference) vector[i] = rotated[r++] as number
    return vector
  }
  if (design === 'latin') {
    if (opts.seed !== undefined) {
      throw new PsiError('invalid_plan', "seed applies only to design 'random'")
    }
    const used = new Set<number>()
    for (let j = 0; j < count; j++) {
      const start = Math.min(Math.max(Math.round(((j + 1) * steps) / (count + 1)), 1), steps - 1)
      let g = start
      let tries = 0
      while ((gcd(g, steps) !== 1 || used.has(g)) && tries < steps) {
        g = g === steps - 1 ? 1 : g + 1
        tries++
      }
      if (tries >= steps) break // every multiplier coprime to T is in use
      used.add(g)
      vectors.push(place(Array.from({ length: n - 1 }, (_, r) => ((r + 1) * g) % steps)))
    }
    return vectors
  }
  if (design !== 'random') {
    throw new PsiError('invalid_plan', `design must be 'random' or 'latin', got ${String(design)}`)
  }
  const rng = new Xoshiro128(opts.seed ?? 0)
  for (let j = 0; j < count; j++) {
    // partial Fisher–Yates over {1, …, T−1} with a sparse swap map
    const swapped = new Map<number, number>()
    const drawn: number[] = []
    for (let r = 0; r < n - 1; r++) {
      const pick = r + rng.uniformInt(steps - 1 - r)
      const value = swapped.get(pick) ?? pick
      swapped.set(pick, swapped.get(r) ?? r)
      drawn.push(value + 1)
    }
    vectors.push(place(drawn))
  }
  return vectors
}

function offsetVectors(n: number, steps: number, opts: SurrogateOptions): number[][] {
  if (opts.sourceOffsets !== undefined) {
    for (const key of ['rotate', 'offsets', 'design', 'seed', 'surrogates', 'count'] as const) {
      if (opts[key] !== undefined) {
        throw new PsiError('invalid_plan', `sourceOffsets cannot be combined with ${key}`)
      }
    }
    if (opts.sourceOffsets.length === 0) {
      throw new PsiError('invalid_plan', 'sourceOffsets must not be empty')
    }
    return opts.sourceOffsets.map((vector, j) => {
      if (vector.length !== n) {
        throw new PsiError(
          'invalid_plan',
          `sourceOffsets[${j}] has ${vector.length} entries for ${n} series`,
        )
      }
      const normalized = vector.map((o) => normalize(o, steps, 'sourceOffsets'))
      if (normalized.every((o) => o === normalized[0])) {
        throw new PsiError(
          'invalid_plan',
          `sourceOffsets[${j}] shifts every source equally — that preserves cross-source alignment`,
        )
      }
      return normalized
    })
  }
  const rotate = opts.rotate ?? 'one'
  const sourceIndex = opts.sourceIndex ?? 0
  if (!Number.isInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= n) {
    throw new PsiError(
      'invalid_plan',
      `sourceIndex ${sourceIndex} is outside the ${n} available series`,
    )
  }
  if (rotate === 'all-but-one') {
    if (opts.offsets !== undefined) {
      throw new PsiError(
        'invalid_plan',
        "offsets do not apply to rotate: 'all-but-one' (use sourceOffsets)",
      )
    }
    return allButOneVectors(n, steps, sourceIndex, opts)
  }
  if (rotate !== 'one' && rotate !== 'all') {
    throw new PsiError(
      'invalid_plan',
      `rotate must be 'one', 'all-but-one', or 'all', got ${String(rotate)}`,
    )
  }
  for (const key of ['design', 'seed'] as const) {
    if (opts[key] !== undefined) {
      throw new PsiError('invalid_plan', `${key} applies only to rotate: 'all-but-one'`)
    }
  }
  if (rotate === 'all' && opts.sourceIndex !== undefined) {
    throw new PsiError('invalid_plan', "sourceIndex does not apply to rotate: 'all'")
  }
  return scalarOffsets(steps, opts).map((offset) =>
    Array.from({ length: n }, (_, i) => (rotate === 'all' || i === sourceIndex ? offset : 0)),
  )
}

/**
 * Time-offset surrogates: circularly rotate sources' trial sums,
 * $x'_{i,t} = x_{i,(t + \tau_i) \bmod T}$, keeping every timestamp grid in
 * place. A rotation preserves each source's marginal distribution and
 * autocorrelation exactly while misaligning it against sources rotated by a
 * different offset (the surrogate-data method of Theiler et al. 1992).
 * Recompute a statistic per surrogate and call {@link permutationP} for an
 * empirical p with resolution $1/(m+1)$.
 *
 * Which null you get depends on `rotate` (see {@link SurrogateOptions}): the
 * default `'one'` only tests source $i$ against the rest — with $N \ge 3$ it
 * leaves most pair alignments intact and has little power against a
 * network-wide effect; `'all-but-one'` misaligns every pair; `'all'` is the
 * GCP pseudo-event resampling (Bancel & Nelson 2008) that shifts the window
 * over the recording. {@link placeboWindows} is the non-circular pseudo-event
 * variant with exclusion zones.
 *
 * Deterministic (explicit, evenly spaced, latin, or seeded offsets) and lazy:
 * each surrogate is materialized only when pulled; unrotated series are shared
 * by reference.
 *
 * @throws {PsiError} `invalid_plan` (bad options), `source_mismatch` (series
 *   of different lengths), `insufficient_data` (fewer than 2 trials, or fewer
 *   trials than sources for `'all-but-one'`).
 */
export function* timeOffsetSurrogates(
  seriesBySource: readonly TrialSeries[],
  opts: SurrogateOptions = {},
): Generator<Surrogate> {
  if (seriesBySource.length === 0) {
    throw new PsiError('invalid_plan', 'timeOffsetSurrogates needs at least one series')
  }
  const reference = seriesBySource[0] as TrialSeries
  const steps = reference.sums.length
  for (const s of seriesBySource) {
    if (s.sums.length !== steps) {
      throw new PsiError(
        'source_mismatch',
        `series are not step-aligned: ${s.source} has ${s.sums.length} trials, ${reference.source} has ${steps}`,
        { source: s.source },
      )
    }
  }
  if (steps < 2) {
    throw new PsiError(
      'insufficient_data',
      `time-offset surrogates need at least 2 trials, got ${steps}`,
    )
  }
  const vectors = offsetVectors(seriesBySource.length, steps, opts)
  for (const vector of vectors) {
    const series = seriesBySource.map((s, i) => {
      const offset = vector[i] as number
      if (offset === 0) return s
      const sums = new Float64Array(steps)
      for (let t = 0; t < steps; t++) sums[t] = s.sums[(t + offset) % steps] as number
      return Object.freeze({
        source: s.source,
        bitsPerTrial: s.bitsPerTrial,
        sums,
        ...(s.timestamps && { timestamps: s.timestamps }),
      }) as TrialSeries
    })
    yield Object.freeze({
      offset: vector.find((o) => o !== 0) ?? 0,
      offsets: Object.freeze([...vector]),
      series: Object.freeze(series),
    })
  }
}

/**
 * Permutation/randomization p-value with the +1 correction:
 * $$p = \frac{1 + \left|\{ i : s_i \ge s_{\text{obs}} \}\right|}{1 + m}$$
 * for $m$ surrogate statistics — the observed arrangement counts as one
 * member of its own null ensemble, so $p$ can never be 0 and its resolution
 * is $1/(m+1)$ (Davison & Hinkley 1997 §4.2.3; North, Curtis & Sham 2002;
 * Phipson & Smyth 2010). Upper-tail convention: larger statistics are more
 * extreme (ties count against the observation).
 *
 * @throws {PsiError} `insufficient_data` for no surrogates; `invalid_plan`
 *   for a non-finite observed or surrogate statistic.
 */
export function permutationP(observed: number, surrogateStats: ArrayLike<number>): number {
  if (surrogateStats.length === 0) {
    throw new PsiError('insufficient_data', 'permutationP needs at least one surrogate statistic')
  }
  if (!Number.isFinite(observed)) {
    throw new PsiError('invalid_plan', `observed statistic must be finite, got ${observed}`)
  }
  let atLeast = 0
  for (let i = 0; i < surrogateStats.length; i++) {
    const s = surrogateStats[i] as number
    if (!Number.isFinite(s)) {
      throw new PsiError('invalid_plan', `surrogate statistic ${i} is not finite: ${s}`)
    }
    if (s >= observed) atLeast++
  }
  return (1 + atLeast) / (1 + surrogateStats.length)
}
