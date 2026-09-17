/**
 * Analytic significance for discrete transfer entropy: the likelihood-ratio
 * χ² null of Barnett & Bossomaier (2012, "Transfer entropy as a log-likelihood
 * ratio", Phys. Rev. Lett. 109, 138105), with an explicit sample-adequacy
 * guard for the regime where the asymptotics fail.
 */

import { chi2Sf } from '@mindpeeker/negentropy/numerics'
import { FlowError } from './errors.js'
import { cmiEvaluate } from './internal/cmi.js'
import { setupTransferEntropy, sourceBlock, type TeSetup } from './internal/embedding.js'
import type { LocalTransferEntropyOptions } from './transfer.js'

/** Options for {@link chiSquareTest}: the TE embedding plus the adequacy rule. */
export interface ChiSquareTestOptions extends LocalTransferEntropyOptions {
  /**
   * Adequacy rule: the test is flagged `adequate` only when
   * `count ≥ minSamplesPerCell · cells`. Default 10. Must be finite and ≥ 0.
   */
  minSamplesPerCell?: number
}

/** Result of {@link chiSquareTest}. */
export interface ChiSquareTestResult {
  /** Plug-in $TE_{X \to Y}$ in bits (never Miller–Madow corrected). */
  readonly te: number
  /** Likelihood-ratio statistic $G = 2 N \ln 2 \cdot TE_{bits}$ ($N$ = `count`). */
  readonly statistic: number
  /**
   * Degrees of freedom $d = (A_Y - 1)\, A_Y^{k}\, (A_X^{l} - 1)$ — with a
   * common alphabet $A$: $(A - 1) A^k (A^l - 1)$. $A_X, A_Y$ are the
   * `alphabet` option when given, else each stream's `max(symbol) + 1`.
   * Inexact (rounded) beyond $2^{53}$.
   */
  readonly df: number
  /** Asymptotic p-value $P(\chi^2_d \ge G) = Q(d/2, G/2)$; 1 when $d = 0$. */
  readonly p: number
  /** Number of embedded tuples $N$. */
  readonly count: number
  /** Size of the joint $(y_{t+1}, y_t^{(k)}, x^{(l)})$ table: $A_Y^{k+1} A_X^{l}$. */
  readonly cells: number
  /** Joint cells actually observed. */
  readonly occupiedCells: number
  /** `count ≥ minSamplesPerCell · cells` — only then trust `p`. */
  readonly adequate: boolean
  readonly minSamplesPerCell: number
}

/** χ² survival with guards for degenerate and astronomically large df. */
export function chiSquareP(statistic: number, df: number): number {
  if (df === 0 || statistic <= 0) return 1
  // Beyond the validated range of the incomplete gamma the upper tail at any
  // attainable statistic (≤ 2N ln A < df/2) is 1 to double precision (Chernoff).
  if (df > 1e9 && statistic <= df / 2) return 1
  try {
    return chi2Sf(statistic, df)
  } catch (cause) {
    throw new FlowError(
      'invalid_input',
      `chi-square tail failed for statistic ${statistic}, df ${df}`,
      { cause },
    )
  }
}

/** Degrees of freedom, table size, statistic and p for a prepared set-up. */
export function chiSquareFromSetup(
  setup: TeSetup,
  te: number,
  occupiedCells: number,
  minSamplesPerCell: number,
): Omit<ChiSquareTestResult, 'te'> {
  const ax = setup.xs.radix
  const ay = setup.ys.radix
  const { k, l } = setup.embedding
  const df = (ay - 1) * ay ** k * (ax ** l - 1)
  const cells = ay ** (k + 1) * ax ** l
  const statistic = 2 * setup.count * Math.LN2 * te
  return {
    statistic,
    df,
    p: chiSquareP(statistic, df),
    count: setup.count,
    cells,
    occupiedCells,
    adequate: setup.count >= minSamplesPerCell * cells,
    minSamplesPerCell,
  }
}

/** Validate the adequacy multiplier. */
export function resolveMinSamplesPerCell(value: number | undefined): number {
  const m = value ?? 10
  if (!Number.isFinite(m) || m < 0) {
    throw new FlowError('invalid_input', `minSamplesPerCell must be finite and ≥ 0, got ${m}`)
  }
  return m
}

/**
 * Asymptotic χ² test of $TE_{X \to Y} = 0$ (Barnett & Bossomaier 2012). Under
 * the null that $y_{t+1}$ is conditionally independent of $x^{(l)}$ given
 * $y_t^{(k)}$, and with every cell probability positive,
 * $$G = 2N \ln 2 \cdot \widehat{TE}_{bits} \xrightarrow{d} \chi^2_d,\qquad
 *   d = (A_Y - 1)\, A_Y^{k}\, (A_X^{l} - 1)$$
 * ($N$ = number of embedded tuples) — the plug-in TE is exactly a
 * log-likelihood ratio, and $\mathbb E[G] \approx d$ explains the familiar
 * bias $\approx d / (2N \ln 2)$ bits.
 *
 * **Validity.** The approximation needs $N \gg$ `cells` $= A_Y^{k+1} A_X^l$:
 * binary $k = l = 1$ is well calibrated from $N \approx 100$, but alphabet 4
 * with $k = 2$ at $N = 500$ rejects a true null more than half the time.
 * `adequate` is true only when `count ≥ minSamplesPerCell · cells` (default
 * 10); otherwise, or when zero-probability cells / the wrong Markov order are
 * plausible, use `permutationTest` (e.g. `'circularShift'` for autocorrelated
 * sources). The test is one-sided on the plug-in value; `millerMadow` is not
 * accepted.
 */
export function chiSquareTest(
  source: ArrayLike<number>,
  dest: ArrayLike<number>,
  opts: ChiSquareTestOptions = {},
): ChiSquareTestResult {
  if ((opts as { millerMadow?: unknown }).millerMadow === true) {
    throw new FlowError(
      'invalid_input',
      'chiSquareTest uses the plug-in estimate; drop millerMadow',
    )
  }
  const minSamplesPerCell = resolveMinSamplesPerCell(opts.minSamplesPerCell)
  const setup = setupTransferEntropy('chiSquareTest', source, dest, opts)
  const value = cmiEvaluate(setup.base, sourceBlock(setup))
  const te = Math.max(0, value.plugin)
  return { te, ...chiSquareFromSetup(setup, te, value.cstCells, minSamplesPerCell) }
}
