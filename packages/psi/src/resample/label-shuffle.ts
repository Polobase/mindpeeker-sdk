import { lnGamma } from '@mindpeeker/negentropy/numerics'
import { PsiError } from '../errors.js'
import { type Seed, seedToUint64, Xoshiro128 } from '../internal/prng.js'
import { assertInteger } from '../internal/validate.js'

/** Default number of surrogate relabelings — p resolution $1/(m+1) = 1/101$. */
export const DEFAULT_SURROGATES = 100

/** Options for {@link labelShuffleSurrogates}. */
export interface LabelShuffleOptions {
  /**
   * `'permutation'` (default): uniformly random count-preserving relabelings
   * (seeded Fisher–Yates), or — when few enough exist — every distinct
   * relabeling exactly once. `'rotation'`: every circular rotation of the
   * label vector (the cyclic group), identity copies included — exact but
   * nearly powerless for periodic designs (an alternating vector has only two
   * distinct rotations, so $p \in \{\tfrac12, 1\}$).
   */
  method?: 'permutation' | 'rotation'
  /** Permutation method: relabelings to draw, integer ≥ 1. Default {@link DEFAULT_SURROGATES}. */
  surrogates?: number
  /** @deprecated Alias of `surrogates` (0.1.x name). */
  count?: number
  /** Permutation method: PRNG seed — part of the pre-registration. Default `0`. */
  seed?: Seed
  /** Rotation method: explicit circular offsets (integers, nonzero modulo the label count). */
  offsets?: readonly number[]
}

/** What {@link labelShuffleSurrogates} will generate for a label vector — see {@link describeLabelShuffle}. */
export interface LabelShuffleDescription {
  /** `'exact'` enumeration, `'random'` Monte-Carlo draws, or the `'rotation'` group. */
  readonly method: 'exact' | 'random' | 'rotation'
  /** Surrogate relabelings the generator yields ($m$). */
  readonly surrogates: number
  /**
   * Distinct count-preserving labelings $n!/\prod_c n_c!$ including the
   * observed one — exact up to $2^{53}$, a floating-point value above.
   */
  readonly distinctLabelings: number
  /** Smallest attainable {@link permutationP}: $1/(m+1)$. */
  readonly resolution: number
}

interface Resolved {
  readonly method: 'exact' | 'random' | 'rotation'
  readonly surrogates: number
  readonly distinct: number
  readonly ids: readonly number[]
  readonly representatives: readonly unknown[]
  readonly offsets?: readonly number[]
  readonly seed: Seed
}

/** Distinct multiset permutations n!/∏ n_c! — exact BigInt until 2^53, then lnGamma. */
function distinctLabelings(counts: readonly number[]): number {
  const cap = BigInt(Number.MAX_SAFE_INTEGER)
  let total = 0
  let value = 1n
  for (const c of counts) {
    for (let i = 1; i <= c; i++) {
      total++
      value = (value * BigInt(total)) / BigInt(i) // stays integral: C(total, i) prefix products
      if (value > cap) {
        const n = counts.reduce((a, b) => a + b, 0)
        let ln = lnGamma(n + 1)
        for (const k of counts) ln -= lnGamma(k + 1)
        return Math.exp(ln)
      }
    }
  }
  return Number(value)
}

function resolve(labels: readonly unknown[], opts: LabelShuffleOptions): Resolved {
  if (!Array.isArray(labels as unknown)) {
    throw new PsiError('invalid_plan', 'labels must be an array')
  }
  const n = labels.length
  if (n < 2) {
    throw new PsiError('insufficient_data', `label-shuffle surrogates need ≥ 2 labels, got ${n}`)
  }
  const ids: number[] = []
  const representatives: unknown[] = []
  const counts: number[] = []
  const idOf = new Map<unknown, number>()
  for (const label of labels) {
    let id = idOf.get(label)
    if (id === undefined) {
      id = representatives.length
      idOf.set(label, id)
      representatives.push(label)
      counts.push(0)
    }
    ids.push(id)
    counts[id] = (counts[id] as number) + 1
  }
  const distinct = distinctLabelings(counts)
  const method = opts.method ?? 'permutation'
  if (method === 'rotation') {
    for (const key of ['surrogates', 'count', 'seed'] as const) {
      if (opts[key] !== undefined) {
        throw new PsiError('invalid_plan', `${key} does not apply to method 'rotation'`)
      }
    }
    const offsets = (opts.offsets ?? Array.from({ length: n - 1 }, (_, i) => i + 1)).map((o) => {
      if (!Number.isInteger(o) || ((o % n) + n) % n === 0) {
        throw new PsiError(
          'invalid_plan',
          `rotation offset ${o} must be an integer nonzero mod ${n}`,
        )
      }
      return ((o % n) + n) % n
    })
    if (offsets.length === 0) throw new PsiError('invalid_plan', 'offsets must not be empty')
    return {
      method,
      surrogates: offsets.length,
      distinct,
      ids,
      representatives,
      offsets,
      seed: 0,
    }
  }
  if (method !== 'permutation') {
    throw new PsiError(
      'invalid_plan',
      `method must be 'permutation' or 'rotation', got ${String(method)}`,
    )
  }
  if (opts.offsets !== undefined) {
    throw new PsiError('invalid_plan', "offsets apply only to method 'rotation'")
  }
  if (opts.surrogates !== undefined && opts.count !== undefined && opts.surrogates !== opts.count) {
    throw new PsiError('invalid_plan', 'surrogates and its deprecated alias count disagree')
  }
  const m = assertInteger(opts.surrogates ?? opts.count ?? DEFAULT_SURROGATES, 1, 'surrogates')
  const seed = opts.seed ?? 0
  seedToUint64(seed)
  if (distinct - 1 <= m) {
    if (distinct < 2) {
      throw new PsiError(
        'insufficient_data',
        'every label is identical — no relabeling can differ from the observed one',
      )
    }
    return { method: 'exact', surrogates: distinct - 1, distinct, ids, representatives, seed }
  }
  return { method: 'random', surrogates: m, distinct, ids, representatives, seed }
}

/**
 * Describe the null ensemble {@link labelShuffleSurrogates} would generate
 * for these labels and options, without generating it: the method actually
 * used, the surrogate count $m$, the number of distinct labelings, and the
 * p-value resolution $1/(m+1)$. Report it next to any permutation p.
 *
 * @throws {PsiError} as {@link labelShuffleSurrogates}.
 */
export function describeLabelShuffle(
  labels: readonly unknown[],
  opts: LabelShuffleOptions = {},
): LabelShuffleDescription {
  const r = resolve(labels, opts)
  return Object.freeze({
    method: r.method,
    surrogates: r.surrogates,
    distinctLabelings: r.distinct,
    resolution: 1 / (r.surrogates + 1),
  })
}

/** In-place next lexicographic permutation of a multiset; false after the last one. */
function nextPermutation(a: number[]): boolean {
  let i = a.length - 2
  while (i >= 0 && (a[i] as number) >= (a[i + 1] as number)) i--
  if (i < 0) return false
  let j = a.length - 1
  while ((a[j] as number) <= (a[i] as number)) j--
  ;[a[i], a[j]] = [a[j] as number, a[i] as number]
  for (let lo = i + 1, hi = a.length - 1; lo < hi; lo++, hi--) {
    ;[a[lo], a[hi]] = [a[hi] as number, a[lo] as number]
  }
  return true
}

/**
 * Label-shuffle surrogates: relabelings of a sequence of condition labels
 * (e.g. presentiment `target`/`control`) that preserve the exact count of
 * each label while breaking its association with the fixed epoch data.
 * Recompute a target-vs-control statistic per relabeling and call
 * {@link permutationP}; under exchangeability of the labels (H0) the result
 * is a valid randomization p (Lehmann & Romano 2005 §15.2; Phipson & Smyth
 * 2010 for the $+1$ convention with random draws).
 *
 * Methods (see {@link LabelShuffleOptions}):
 * - **exact** — chosen automatically when the distinct relabelings other than
 *   the observed one number at most `surrogates`: each is yielded once, in
 *   lexicographic order of first-appearance label ids, so `permutationP`
 *   equals the exact enumeration p $\#\{\text{labelings with } s \ge s_\text{obs}\}/\#\text{labelings}$.
 * - **random** — `surrogates` independent uniform permutations (seeded
 *   Fisher–Yates over xoshiro128**; draws may repeat or equal the observed
 *   labeling, which is what keeps $p = (1+b)/(1+m)$ valid). Resolution $1/(m+1)$:
 *   raise `surrogates` for claims below 0.01.
 * - **rotation** — opt-in, all $n-1$ nonzero circular rotations (or explicit
 *   `offsets`), identity copies *included*. 0.1.x skipped rotations that
 *   reproduced the observed labeling, which for the canonical alternating
 *   design left $m$ copies of the complement and $P(p \le 0.05 \mid H_0) \approx 0.46$.
 *
 * Deterministic and lazy: the same labels, options, and seed always yield the
 * same relabelings, each a fresh array materialized per pull (typed
 * `readonly`, not frozen — `Object.freeze` on arrays dominates the cost of a
 * 10⁵-surrogate loop). Labels are compared
 * by `Map` key identity (SameValueZero).
 *
 * @throws {PsiError} `insufficient_data` for fewer than 2 labels or labels
 *   that are all identical (permutation method); `invalid_plan` for bad
 *   options, seeds, or options that do not apply to the chosen method.
 */
export function* labelShuffleSurrogates<T>(
  labels: readonly T[],
  opts: LabelShuffleOptions = {},
): Generator<readonly T[]> {
  const r = resolve(labels, opts)
  const n = labels.length
  const reps = r.representatives as readonly T[]
  if (r.method === 'rotation') {
    for (const offset of r.offsets ?? []) {
      yield labels.map((_, i) => labels[(i + offset) % n] as T)
    }
    return
  }
  if (r.method === 'exact') {
    const current = [...r.ids].sort((a, b) => a - b)
    do {
      let identical = true
      for (let i = 0; i < n; i++) {
        if (current[i] !== r.ids[i]) {
          identical = false
          break
        }
      }
      if (!identical) yield current.map((id) => reps[id] as T)
    } while (nextPermutation(current))
    return
  }
  const rng = new Xoshiro128(r.seed)
  for (let b = 0; b < r.surrogates; b++) {
    yield rng.shuffle([...labels])
  }
}
