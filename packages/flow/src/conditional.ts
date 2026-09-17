/**
 * Multivariate transfer entropy: conditional (complete) TE, which removes
 * flow explained by observed third streams (Lizier, Prokopenko & Zomaya 2008,
 * Phys. Rev. E 77, 026110), and collective TE, the joint transfer from a set
 * of sources (Lizier, Prokopenko & Zomaya 2010, Chaos 20, 037109). See also
 * Bossomaier, Barnett, Harré & Lizier 2016, "An Introduction to Transfer
 * Entropy", ch. 4.
 */

import { FlowError } from './errors.js'
import { cmiBase, cmiEvaluate, finalize } from './internal/cmi.js'
import {
  assertAligned,
  assertCount,
  integerOption,
  prepareSeries,
  resolveEmbedding,
} from './internal/embedding.js'
import { joinKeys, type KeyColumn, lagBlock } from './internal/keys.js'
import { validateAlphabetOption } from './internal/symbols.js'
import type { TransferEntropyOptions } from './transfer.js'

/** Options for {@link conditionalTransferEntropy}: the TE embedding plus the condition embedding. */
export interface ConditionalTransferEntropyOptions extends TransferEntropyOptions {
  /** History length $k_c \ge 1$ taken from EVERY condition stream. Default 1. */
  condK?: number
  /**
   * Lag $u_c \ge 1$ of every condition stream: the most recent condition
   * symbol is $w_{t-u_c+1}$. Default 1 — the condition's value at the same
   * time as the (lag-1) source symbol, PyInform's convention.
   */
  condLag?: number
}

function assertList(what: string, name: string, list: unknown): readonly ArrayLike<number>[] {
  if (!Array.isArray(list)) {
    throw new FlowError('invalid_input', `${what}: ${name} must be an array of symbol series`)
  }
  return list as readonly ArrayLike<number>[]
}

/**
 * Conditional transfer entropy from `source` $X$ to `dest` $Y$ given the
 * condition streams $W_1, \dots, W_m$, in bits:
 * $$TE_{X \to Y \mid W} = \hat I\!\left(Y_{t+1};\, X^{(l)} \,\middle|\,
 *   Y_t^{(k)}, W_1^{(k_c)}, \dots, W_m^{(k_c)}\right)$$
 * with $x^{(l)}$ as in `transferEntropy` and
 * $w^{(k_c)} = (w_{t-u_c+1}, \dots, w_{t-u_c-k_c+2})$. Tuples start at
 * $t = \max(k - 1,\; u + l - 2,\; u_c + k_c - 2)$. With no conditions it is
 * exactly `transferEntropy`. Conditioning on a common driver removes the
 * spurious flow it induces — but conditioning can also *reveal* synergistic
 * flow, so the value may exceed the pairwise TE. Clamped at 0 unless
 * `millerMadow` is set; every series must be aligned and share `alphabet`
 * (when given).
 */
export function conditionalTransferEntropy(
  source: ArrayLike<number>,
  dest: ArrayLike<number>,
  conditions: readonly ArrayLike<number>[],
  opts: ConditionalTransferEntropyOptions = {},
): number {
  const what = 'conditionalTransferEntropy'
  const e = resolveEmbedding(opts)
  const condK = integerOption(opts.condK, 'condK', 1)
  const condLag = integerOption(opts.condLag, 'condLag', 1)
  const conds = assertList(what, 'conditions', conditions)
  const n = assertAligned(what, [
    ['source', source],
    ['dest', dest],
    ...conds.map((c, i) => [`conditions[${i}]`, c] as const),
  ])
  const alphabet = validateAlphabetOption(opts.alphabet)
  const xs = prepareSeries(source, 'source', alphabet)
  const ys = prepareSeries(dest, 'dest', alphabet)
  const ws = conds.map((c, i) => prepareSeries(c, `conditions[${i}]`, alphabet))
  const first = Math.max(e.k - 1, e.lag + e.l - 2, ws.length > 0 ? condLag + condK - 2 : 0)
  const count = n - 1 - first
  assertCount(what, count, first + 3, n)
  let condition: KeyColumn = lagBlock(ys, first, count, 0, e.k)
  for (const w of ws) condition = joinKeys(condition, lagBlock(w, first, count, condLag - 1, condK))
  const base = cmiBase(lagBlock(ys, first, count, -1, 1), condition)
  const value = cmiEvaluate(base, lagBlock(xs, first, count, e.lag - 1, e.l))
  return finalize(value, opts.millerMadow === true)
}

/**
 * Collective transfer entropy from the sources $X_1, \dots, X_m$ jointly to
 * `dest` $Y$, in bits (Lizier, Prokopenko & Zomaya 2010):
 * $$TE_{\{X_i\} \to Y} = \hat I\!\left(Y_{t+1};\, X_1^{(l)}, \dots, X_m^{(l)}
 *   \,\middle|\, Y_t^{(k)}\right)$$
 * Every source uses the same `l` and `lag`. Captures synergy the pairwise
 * values miss (e.g. $y_{t+1} = x_{1,t} \oplus x_{2,t}$: each pairwise TE is
 * ≈ 0, the collective TE ≈ 1 bit). With one source it is exactly
 * `transferEntropy`. Clamped at 0 unless `millerMadow` is set.
 */
export function collectiveTransferEntropy(
  sources: readonly ArrayLike<number>[],
  dest: ArrayLike<number>,
  opts: TransferEntropyOptions = {},
): number {
  const what = 'collectiveTransferEntropy'
  const e = resolveEmbedding(opts)
  const srcs = assertList(what, 'sources', sources)
  if (srcs.length === 0) {
    throw new FlowError('invalid_input', `${what} needs at least one source`)
  }
  const n = assertAligned(what, [
    ['dest', dest],
    ...srcs.map((s, i) => [`sources[${i}]`, s] as const),
  ])
  const alphabet = validateAlphabetOption(opts.alphabet)
  const ys = prepareSeries(dest, 'dest', alphabet)
  const xs = srcs.map((s, i) => prepareSeries(s, `sources[${i}]`, alphabet))
  const first = Math.max(e.k - 1, e.lag + e.l - 2)
  const count = n - 1 - first
  assertCount(what, count, first + 3, n)
  const base = cmiBase(lagBlock(ys, first, count, -1, 1), lagBlock(ys, first, count, 0, e.k))
  let joint = lagBlock(xs[0] as (typeof xs)[number], first, count, e.lag - 1, e.l)
  for (let i = 1; i < xs.length; i++) {
    joint = joinKeys(joint, lagBlock(xs[i] as (typeof xs)[number], first, count, e.lag - 1, e.l))
  }
  return finalize(cmiEvaluate(base, joint), opts.millerMadow === true)
}
