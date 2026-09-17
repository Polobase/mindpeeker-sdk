import { NegentropyError } from '../errors.js'
import { assertFiniteArray } from '../internal/assert.js'
import { KahanSum } from '../internal/kahan.js'
import { chi2Cdf, chi2Sf, normPpf } from '../internal/special.js'
import type { StatResult } from '../types.js'
import { checkMatrix } from './network.js'
import { chiSquareP, P_FLOOR } from './pvalues.js'
import { stoufferZ } from './zscores.js'

/**
 * Time-blocked GCP statistics (Bancel & Nelson 2008, "The GCP Event
 * Experiment: Design, Analytical Methods, Results", JSE 22(3), §4). A block
 * B of T consecutive steps (and R sources) is reduced to
 * Z_B = Σ_{t,r∈B} z_{t,r} / √N (eq. 4.1, N = T·R terms) and the event
 * statistic is χ² = Σ_B Z_B² on B degrees of freedom (eq. 4.2). Network
 * variance blocks over all sources, device variance over one; T = 1 gives
 * the ordinary `netvar`/`devvar`. Blocks tile the series from step 0; a
 * trailing remainder shorter than T is dropped and reported.
 */

/** Blocking length T (steps per block), a positive integer. */
export interface BlockOptions {
  T: number
}

/** Blocked χ² result: `n` counts the steps inside whole blocks. */
export type BlockedResult = StatResult & {
  T: number
  blocks: number
  /** Trailing steps (< T) that did not fill a block. */
  droppedSteps: number
}

function validateBlock(T: number, steps: number, fn: string): number {
  if (!Number.isInteger(T) || T < 1) {
    throw new NegentropyError('invalid_config', `${fn}: T must be a positive integer, got ${T}`)
  }
  const blocks = Math.floor(steps / T)
  if (blocks === 0) {
    throw new NegentropyError(
      'insufficient_data',
      `${fn}: ${steps} steps do not fill one block of T = ${T}`,
    )
  }
  return blocks
}

/**
 * Block sums of a z series scaled back to unit variance:
 * out[B] = Σ_{t=B·T}^{(B+1)·T−1} z_t / √T for the ⌊n/T⌋ whole blocks. Under
 * H0 (independent unit-variance z's) the block z's are again N(0, 1); serial
 * correlation at lags < T inflates their variance.
 */
export function blockZ(zs: ArrayLike<number>, T: number): Float64Array {
  const blocks = validateBlock(T, zs.length, 'blockZ')
  assertFiniteArray(zs, 'blockZ: z')
  const out = new Float64Array(blocks)
  const scale = Math.sqrt(T)
  for (let b = 0; b < blocks; b++) {
    const acc = new KahanSum()
    for (let t = b * T; t < (b + 1) * T; t++) acc.add(zs[t] as number)
    out[b] = acc.value / scale
  }
  return out
}

function chiSquareOver(blockZs: ArrayLike<number>): number {
  const acc = new KahanSum()
  for (let i = 0; i < blockZs.length; i++) {
    const z = blockZs[i] as number
    acc.add(z * z)
  }
  return acc.value
}

/**
 * Blocked network variance: per step the Stouffer Z across sources, blocked
 * over T steps — Z_B = Σ_{t∈B} Σᵣ z_{t,r}/√(T·N) — and χ² = Σ_B Z_B² ~ χ²(B).
 * Sensitive to inter-source correlation that persists over T steps (T = 1
 * reproduces `netvar` exactly).
 */
export function blockedNetvar(
  zBySource: readonly Float64Array[],
  sources: readonly string[],
  opts: BlockOptions,
): BlockedResult {
  const steps = checkMatrix(zBySource, sources)
  const T = opts?.T
  const blocks = validateBlock(T, steps, 'blockedNetvar')
  const stouffers = new Float64Array(blocks * T)
  const column = new Float64Array(zBySource.length)
  for (let t = 0; t < blocks * T; t++) {
    for (let i = 0; i < zBySource.length; i++)
      column[i] = (zBySource[i] as Float64Array)[t] as number
    stouffers[t] = stoufferZ(column)
  }
  const statistic = T === 1 ? chiSquareOver(stouffers) : chiSquareOver(blockZ(stouffers, T))
  return {
    statistic,
    df: blocks,
    pValue: chiSquareP(statistic, blocks),
    n: blocks * T,
    sources: [...sources],
    T,
    blocks,
    droppedSteps: steps - blocks * T,
  }
}

/**
 * Blocked device variance: each source blocked on its own over T steps,
 * χ² = Σᵣ Σ_B Z_{B,r}² ~ χ²(B·N). Sensitive to a source's serial correlation
 * (autocorrelation) within T steps and to variance changes; blind to
 * cross-source correlation (T = 1 reproduces `devvar` exactly). GCP's device
 * variance recipes used T = 120 … 3600 s.
 */
export function blockedDevvar(
  zBySource: readonly Float64Array[],
  sources: readonly string[],
  opts: BlockOptions,
): BlockedResult {
  const steps = checkMatrix(zBySource, sources)
  const T = opts?.T
  const blocks = validateBlock(T, steps, 'blockedDevvar')
  const acc = new KahanSum()
  for (const zs of zBySource) {
    if (T === 1) {
      for (let t = 0; t < blocks; t++) {
        const z = zs[t] as number
        acc.add(z * z)
      }
    } else {
      for (const z of blockZ(zs.subarray(0, blocks * T), T)) acc.add(z * z)
    }
  }
  const df = blocks * zBySource.length
  const statistic = acc.value
  return {
    statistic,
    df,
    pValue: chiSquareP(statistic, df),
    n: blocks * T,
    sources: [...sources],
    T,
    blocks,
    droppedSteps: steps - blocks * T,
  }
}

/**
 * Signed normal-equivalent z of a χ² statistic's one-tailed upper p — the GCP
 * event-z convention (eq. 4.3) — computed from whichever tail is smaller so
 * neither 1 − p nor a probit of 1 ever occurs.
 */
function chiSquareZ(statistic: number, df: number): number {
  const upper = chi2Sf(statistic, df)
  if (upper <= 0.5) return -normPpf(Math.max(upper, P_FLOOR))
  return normPpf(Math.max(chi2Cdf(statistic, df), P_FLOOR))
}

/** One blocking length in a `blockingDecomposition`. */
export interface BlockingPoint {
  T: number
  blocks: number
  /** χ² = Σ_B Z_B² of the blocked Stouffer series, and its upper-tail p on `blocks` df. */
  statistic: number
  pValue: number
  /** Event z (probit of the one-tailed p). */
  z: number
  /** z₀/√T — the value expected when the 1-step Z's have no autocorrelation. */
  expected: number
  /** √(2T₀/T³)·Σ_{l=1}^{T−1}(T − l)·ρ(l) — the autocorrelation term of eq. 4.6. */
  autocorrelationTerm: number
  /** expected + autocorrelationTerm (eq. 4.6). */
  predicted: number
  /** H0 standard deviation of z − expected, √(1 − 1/T) (Cov(z_T, z₀) = 1/√T). */
  residualSd: number
}

/**
 * Blocking decomposition of an event's network variance (Bancel & Nelson
 * 2008, eqs. 4.4–4.6). With χ²_T the blocked netvar over T-step blocks of the
 * T₀-step Stouffer series,
 * $$\chi^2_T = \chi^2_1/T + \gamma_T, \qquad
 *   Z_T \approx \frac{Z_0}{\sqrt T} + \sqrt{\frac{2T_0}{T^3}}\sum_{l=1}^{T-1}(T-l)\,\rho(l),$$
 * Z₀ the 1-step event z and ρ(l) the autocorrelation of the 1-step Z's about
 * their theoretical mean 0 (ρ(l) = Σₜ ZₜZₜ₊ₗ / Σₜ Zₜ², averaged over every
 * blocking phase). When ρ ≡ 0 the observed z falls as 1/√T; Bancel & Nelson
 * found the formal GCP result within 1σ of that curve — the deviation lived
 * in 1-second inter-RNG correlation, not in temporal structure. Compare
 * `z − expected` against `residualSd`; `predicted` tracks `z` when the
 * linearization holds (many blocks). z's are probits of χ² tails (the GCP
 * convention), so the relation is approximate at few blocks. Every T must be
 * a positive integer with at least one whole block.
 */
export function blockingDecomposition(
  stoufferZs: ArrayLike<number>,
  Ts: readonly number[],
): { steps: number; z0: number; points: BlockingPoint[] } {
  const steps = stoufferZs.length
  if (steps < 2) {
    throw new NegentropyError(
      'insufficient_data',
      `blockingDecomposition needs ≥ 2 steps, got ${steps}`,
    )
  }
  if (!Array.isArray(Ts) || Ts.length === 0) {
    throw new NegentropyError('invalid_config', 'blockingDecomposition needs at least one T')
  }
  for (const T of Ts) validateBlock(T, steps, 'blockingDecomposition')
  assertFiniteArray(stoufferZs, 'blockingDecomposition: z')
  const zs = Float64Array.from(stoufferZs)
  const energy = chiSquareOver(zs)
  const z0 = chiSquareZ(energy, steps)
  const maxLag = Math.max(...Ts) - 1
  const rho = new Float64Array(maxLag + 1)
  if (energy > 0) {
    for (let lag = 1; lag <= maxLag && lag < steps; lag++) {
      const acc = new KahanSum()
      for (let t = 0; t + lag < steps; t++) acc.add((zs[t] as number) * (zs[t + lag] as number))
      rho[lag] = acc.value / energy
    }
  }
  const points = Ts.map((T): BlockingPoint => {
    const blocks = Math.floor(steps / T)
    const statistic = T === 1 ? energy : chiSquareOver(blockZ(zs, T))
    const weighted = new KahanSum()
    for (let lag = 1; lag < T; lag++) weighted.add((T - lag) * (rho[lag] as number))
    const expected = z0 / Math.sqrt(T)
    const autocorrelationTerm = Math.sqrt((2 * steps) / (T * T * T)) * weighted.value
    return {
      T,
      blocks,
      statistic,
      pValue: chiSquareP(statistic, blocks),
      z: chiSquareZ(statistic, blocks),
      expected,
      autocorrelationTerm,
      predicted: expected + autocorrelationTerm,
      residualSd: Math.sqrt(1 - 1 / T),
    }
  })
  return { steps, z0, points }
}
