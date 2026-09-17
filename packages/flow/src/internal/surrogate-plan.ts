/**
 * Validation and generation of surrogate ensembles shared by
 * `permutationTest`, `transferEntropyReport` and `transferEntropyByLag`.
 */

import { FlowError } from '../errors.js'
import {
  blockShuffle,
  circularShift,
  defaultBlockLength,
  markovSurrogate,
  rotate,
  sourceShuffle,
  stationaryBootstrap,
} from '../surrogates.js'
import { randomInt, validateSeed, xoshiro128ss } from './prng.js'

/** Which surrogate null the source is drawn from. */
export type SurrogateMethod =
  | 'shuffle'
  | 'circularShift'
  | 'embeddingShuffle'
  | 'blockShuffle'
  | 'stationaryBootstrap'
  | 'markov'

const METHODS: readonly SurrogateMethod[] = Object.freeze([
  'shuffle',
  'circularShift',
  'embeddingShuffle',
  'blockShuffle',
  'stationaryBootstrap',
  'markov',
])

/** Largest accepted surrogate count. */
export const MAX_SURROGATES = 10_000_000

/** Surrogate options shared by every significance function. */
export interface SurrogateOptions {
  /** Number of surrogates to draw. Default 199 (smallest attainable p = 0.005). */
  surrogates?: number
  /**
   * Surrogate null for the source stream. Default `'shuffle'`.
   * - `'shuffle'` — Fisher–Yates of the raw source (keeps the marginal only).
   * - `'circularShift'` — random rotation (keeps all autocorrelation); when
   *   $n - 1 \le$ `surrogates` all $n - 1$ rotations are enumerated instead
   *   (an exact permutation test, `exact: true`).
   * - `'embeddingShuffle'` — permutes the embedded source vectors $x^{(l)}$
   *   across tuples (JIDT's convention; keeps within-vector structure).
   * - `'blockShuffle'` — shuffles blocks of `blockSize`.
   * - `'stationaryBootstrap'` — Politis–Romano resample, mean block `meanBlockSize`.
   * - `'markov'` — order-`markovOrder` Markov chain fitted to the source.
   */
  surrogate?: SurrogateMethod
  /** Seed for the xoshiro128** surrogate PRNG (non-negative safe integer). Default `0x9e3779b9`. */
  seed?: number
  /** Block length for `'blockShuffle'`. Default $\lceil n^{1/3} \rceil$. */
  blockSize?: number
  /** Mean block length for `'stationaryBootstrap'`. Default $\lceil n^{1/3} \rceil$. */
  meanBlockSize?: number
  /** Markov order for `'markov'`. Default 1. */
  markovOrder?: number
}

/** The surrogate configuration actually used — echo it into any record of the test. */
export interface SurrogateInfo {
  readonly method: SurrogateMethod
  /** Ensemble size actually evaluated ($n - 1$ for an exact rotation test). */
  readonly n: number
  readonly seed: number
  /** `true` when every nontrivial rotation was enumerated (no randomness used). */
  readonly exact: boolean
  readonly blockSize?: number
  readonly meanBlockSize?: number
  readonly markovOrder?: number
}

function checkOnly(opts: SurrogateOptions, key: keyof SurrogateOptions, method: SurrogateMethod) {
  if (opts[key] !== undefined && opts.surrogate !== method) {
    throw new FlowError(
      'invalid_input',
      `${key} only applies to surrogate: '${method}' (got surrogate: '${opts.surrogate ?? 'shuffle'}')`,
    )
  }
}

/** Validate surrogate options against a source of length `n` before any estimate runs. */
export function resolveSurrogates(opts: SurrogateOptions, n: number): SurrogateInfo {
  const requested = opts.surrogates ?? 199
  if (!Number.isInteger(requested) || requested < 1 || requested > MAX_SURROGATES) {
    throw new FlowError(
      'invalid_input',
      `surrogates must be an integer in [1, ${MAX_SURROGATES}], got ${requested}`,
    )
  }
  const method = opts.surrogate ?? 'shuffle'
  if (!METHODS.includes(method)) {
    throw new FlowError(
      'invalid_input',
      `surrogate must be one of ${METHODS.map((m) => `'${m}'`).join(', ')}, got ${String(method)}`,
    )
  }
  checkOnly(opts, 'blockSize', 'blockShuffle')
  checkOnly(opts, 'meanBlockSize', 'stationaryBootstrap')
  checkOnly(opts, 'markovOrder', 'markov')
  const seed = validateSeed(opts.seed)
  const upper = Math.max(1, n)
  if (method === 'blockShuffle') {
    const blockSize = opts.blockSize ?? defaultBlockLength(n)
    if (!Number.isInteger(blockSize) || blockSize < 1 || blockSize > upper) {
      throw new FlowError(
        'invalid_input',
        `blockSize must be an integer in [1, ${upper}], got ${blockSize}`,
      )
    }
    return { method, n: requested, seed, exact: false, blockSize }
  }
  if (method === 'stationaryBootstrap') {
    const meanBlockSize = opts.meanBlockSize ?? defaultBlockLength(n)
    if (!Number.isFinite(meanBlockSize) || meanBlockSize < 1 || meanBlockSize > upper) {
      throw new FlowError(
        'invalid_input',
        `meanBlockSize must be a finite number in [1, ${upper}], got ${meanBlockSize}`,
      )
    }
    return { method, n: requested, seed, exact: false, meanBlockSize }
  }
  if (method === 'markov') {
    const markovOrder = opts.markovOrder ?? 1
    if (!Number.isInteger(markovOrder) || markovOrder < 1 || markovOrder > Math.max(1, n - 1)) {
      throw new FlowError(
        'invalid_input',
        `markovOrder must be an integer in [1, ${Math.max(1, n - 1)}], got ${markovOrder}`,
      )
    }
    return { method, n: requested, seed, exact: false, markovOrder }
  }
  if (method === 'circularShift' && n >= 2 && n - 1 <= requested) {
    return { method, n: n - 1, seed, exact: true }
  }
  return { method, n: requested, seed, exact: false }
}

/** One surrogate: a replacement source series, or a permutation of the source tuples. */
export type SurrogateDraw =
  | { readonly kind: 'series'; readonly symbols: Int32Array }
  | { readonly kind: 'permutation'; readonly perm: Int32Array }

/**
 * Lazily draw the ensemble in a fixed order from one seeded generator.
 * `tuples` is the number of embedded tuples (for `'embeddingShuffle'`).
 */
export function* drawSurrogates(
  info: SurrogateInfo,
  source: Int32Array,
  tuples: number,
): Generator<SurrogateDraw> {
  if (info.exact) {
    for (let offset = 1; offset <= info.n; offset++) {
      yield { kind: 'series', symbols: rotate(source, offset) }
    }
    return
  }
  const rng = xoshiro128ss(info.seed)
  for (let i = 0; i < info.n; i++) {
    switch (info.method) {
      case 'shuffle':
        yield { kind: 'series', symbols: sourceShuffle(source, rng) }
        break
      case 'circularShift':
        yield { kind: 'series', symbols: circularShift(source, rng) }
        break
      case 'blockShuffle':
        yield { kind: 'series', symbols: blockShuffle(source, rng, { blockSize: info.blockSize }) }
        break
      case 'stationaryBootstrap':
        yield {
          kind: 'series',
          symbols: stationaryBootstrap(source, rng, { meanBlockSize: info.meanBlockSize }),
        }
        break
      case 'markov':
        yield { kind: 'series', symbols: markovSurrogate(source, rng, { order: info.markovOrder }) }
        break
      case 'embeddingShuffle': {
        const perm = new Int32Array(tuples)
        for (let j = 0; j < tuples; j++) perm[j] = j
        for (let j = tuples - 1; j >= 1; j--) {
          const r = randomInt(rng, j + 1)
          const tmp = perm[j] as number
          perm[j] = perm[r] as number
          perm[r] = tmp
        }
        yield { kind: 'permutation', perm }
        break
      }
    }
  }
}

/** Two values count as tied when within this relative tolerance (rounding of equal tables). */
export const TIE_TOLERANCE = 1e-12

/** `value` is at least as extreme as `observed` (ties within rounding count — conservative). */
export function atLeast(value: number, observed: number): boolean {
  return value >= observed - TIE_TOLERANCE * Math.max(1, Math.abs(observed))
}

/** Summary of a surrogate ensemble relative to an observed statistic. */
export interface EnsembleSummary {
  readonly p: number
  readonly mean: number
  readonly sd: number
  readonly z: number
  readonly distinct: number
}

export function summarize(observed: number, values: Float64Array): EnsembleSummary {
  const n = values.length
  let exceed = 0
  let mean = 0
  for (let i = 0; i < n; i++) {
    const v = values[i] as number
    if (atLeast(v, observed)) exceed++
    mean += (v - mean) / (i + 1)
  }
  let ss = 0
  for (let i = 0; i < n; i++) ss += ((values[i] as number) - mean) ** 2
  const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : Number.NaN
  let z: number
  if (Number.isNaN(sd)) z = Number.NaN
  else if (sd > 0) z = (observed - mean) / sd
  else
    z =
      observed === mean ? 0 : observed > mean ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY
  const sorted = Float64Array.from(values).sort()
  let distinct = n > 0 ? 1 : 0
  for (let i = 1; i < n; i++) {
    const prev = sorted[i - 1] as number
    if (!atLeast(prev, sorted[i] as number)) distinct++
  }
  return { p: (1 + exceed) / (1 + n), mean, sd, z, distinct }
}
