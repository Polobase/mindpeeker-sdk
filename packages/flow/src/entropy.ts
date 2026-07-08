/**
 * Plug-in (maximum-likelihood) information measures over integer symbol
 * arrays, all in base 2 (bits). These are the building blocks transfer
 * entropy is assembled from; they are exported because they are useful on
 * their own and because every closed-form test of the package reduces to
 * them.
 */

import { FlowError } from './errors.js'
import {
  entropyFromCounts,
  tupleCounts,
  validateAlphabetOption,
  validateSymbols,
} from './internal/symbols.js'

export interface EntropyOptions {
  /**
   * Alphabet size $A$; every symbol must lie in $[0, A)$. Default: inferred
   * as `max(symbol) + 1`. The value of a plug-in estimate depends only on
   * the observed counts, so the option affects validation and joint-state
   * key packing, never the result.
   */
  alphabet?: number
  /**
   * Apply the Miller–Madow small-sample bias correction
   * $\hat H_{MM} = \hat H + \frac{K - 1}{2N \ln 2}$ with $K$ the number of
   * occupied cells (Miller 1955). For the composite measures below the
   * correction is applied per entropy term, so corrected mutual information
   * can be slightly negative. Default `false`.
   */
  millerMadow?: boolean
}

function singleCounts(symbols: Int32Array): Map<number, number> {
  const counts = new Map<number, number>()
  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i] as number
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  return counts
}

/**
 * Plug-in Shannon entropy (Shannon 1948) of a symbol sequence, in bits:
 * $$\hat H(X) = -\sum_{x} \hat p(x) \log_2 \hat p(x)$$
 * with $\hat p$ the empirical distribution. Upper-bounded by $\log_2 A$.
 */
export function shannonEntropy(x: ArrayLike<number>, opts: EntropyOptions = {}): number {
  const alphabet = validateAlphabetOption(opts.alphabet)
  const { symbols } = validateSymbols(x, 'x', alphabet)
  if (symbols.length === 0) {
    throw new FlowError('insufficient_data', 'shannonEntropy needs at least 1 sample')
  }
  return entropyFromCounts(
    singleCounts(symbols).values(),
    symbols.length,
    opts.millerMadow === true,
  )
}

/**
 * Plug-in joint Shannon entropy of two or more aligned symbol sequences:
 * $$\hat H(X_1, \dots, X_m) = -\sum \hat p(x_1, \dots, x_m) \log_2 \hat p(x_1, \dots, x_m)$$
 * Tuples are counted with packed integer keys when $A^m < 2^{31}$ and string
 * keys otherwise (see `makeEncoder`).
 */
export function jointEntropy(
  vars: readonly ArrayLike<number>[],
  opts: EntropyOptions = {},
): number {
  if (vars.length === 0) {
    throw new FlowError('invalid_input', 'jointEntropy needs at least one variable')
  }
  const alphabet = validateAlphabetOption(opts.alphabet)
  const n = vars[0]?.length ?? 0
  let maxSymbol = -1
  const cols: Int32Array[] = []
  for (let i = 0; i < vars.length; i++) {
    const v = vars[i] as ArrayLike<number>
    if (v.length !== n) {
      throw new FlowError(
        'invalid_input',
        `jointEntropy variables must share one length: vars[${i}] has ${v.length}, vars[0] has ${n}`,
      )
    }
    const { symbols, maxSymbol: max } = validateSymbols(v, `vars[${i}]`, alphabet)
    if (max > maxSymbol) maxSymbol = max
    cols.push(symbols)
  }
  if (n === 0) throw new FlowError('insufficient_data', 'jointEntropy needs at least 1 sample')
  const a = alphabet ?? maxSymbol + 1
  return entropyFromCounts(tupleCounts(cols, a).values(), n, opts.millerMadow === true)
}

interface PairData {
  readonly xs: Int32Array
  readonly ys: Int32Array
  readonly alphabet: number
  readonly n: number
}

function validatePair(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  name: string,
  opts: EntropyOptions,
): PairData {
  const alphabet = validateAlphabetOption(opts.alphabet)
  if (x.length !== y.length) {
    throw new FlowError(
      'invalid_input',
      `${name} needs aligned sequences: x has ${x.length} samples, y has ${y.length}`,
    )
  }
  const { symbols: xs, maxSymbol: mx } = validateSymbols(x, 'x', alphabet)
  const { symbols: ys, maxSymbol: my } = validateSymbols(y, 'y', alphabet)
  if (xs.length === 0) {
    throw new FlowError('insufficient_data', `${name} needs at least 1 sample`)
  }
  return { xs, ys, alphabet: alphabet ?? Math.max(mx, my) + 1, n: xs.length }
}

/**
 * Plug-in mutual information in bits:
 * $$\hat I(X;Y) = \hat H(X) + \hat H(Y) - \hat H(X, Y)$$
 * Mathematically non-negative for the plug-in estimate; floating-point dust
 * below zero is clamped to 0 unless `millerMadow` is set (the per-term
 * correction can legitimately push the estimate negative).
 */
export function mutualInformation(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  opts: EntropyOptions = {},
): number {
  const { xs, ys, alphabet, n } = validatePair(x, y, 'mutualInformation', opts)
  const mm = opts.millerMadow === true
  const hx = entropyFromCounts(singleCounts(xs).values(), n, mm)
  const hy = entropyFromCounts(singleCounts(ys).values(), n, mm)
  const hxy = entropyFromCounts(tupleCounts([xs, ys], alphabet).values(), n, mm)
  const mi = hx + hy - hxy
  return mm ? mi : Math.max(0, mi)
}

/**
 * Plug-in conditional mutual information in bits:
 * $$\hat I(X;Y \mid Z) = \hat H(X, Z) + \hat H(Y, Z) - \hat H(X, Y, Z) - \hat H(Z)$$
 * This is the exact quantity transfer entropy instantiates with
 * $X = $ source past, $Y = $ destination future, $Z = $ destination past
 * (Schreiber 2000). Clamped at 0 unless `millerMadow` is set.
 */
export function conditionalMutualInformation(
  x: ArrayLike<number>,
  y: ArrayLike<number>,
  z: ArrayLike<number>,
  opts: EntropyOptions = {},
): number {
  const {
    xs,
    ys,
    alphabet: pairAlphabet,
    n,
  } = validatePair(x, y, 'conditionalMutualInformation', opts)
  if (z.length !== n) {
    throw new FlowError(
      'invalid_input',
      `conditionalMutualInformation needs aligned sequences: z has ${z.length} samples, x has ${n}`,
    )
  }
  const { symbols: zs, maxSymbol: mz } = validateSymbols(
    z,
    'z',
    validateAlphabetOption(opts.alphabet),
  )
  const alphabet = opts.alphabet !== undefined ? pairAlphabet : Math.max(pairAlphabet, mz + 1)
  const mm = opts.millerMadow === true
  const hz = entropyFromCounts(singleCounts(zs).values(), n, mm)
  const hxz = entropyFromCounts(tupleCounts([xs, zs], alphabet).values(), n, mm)
  const hyz = entropyFromCounts(tupleCounts([ys, zs], alphabet).values(), n, mm)
  const hxyz = entropyFromCounts(tupleCounts([xs, ys, zs], alphabet).values(), n, mm)
  const cmi = hxz + hyz - hxyz - hz
  return mm ? cmi : Math.max(0, cmi)
}
