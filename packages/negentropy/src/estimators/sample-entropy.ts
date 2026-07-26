import { NegentropyError } from '../errors.js'

/** Population standard deviation — the scale r defaults are quoted against. */
function populationSd(x: ArrayLike<number>): number {
  const n = x.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += x[i] as number
  mean /= n
  let m2 = 0
  for (let i = 0; i < n; i++) m2 += ((x[i] as number) - mean) ** 2
  return Math.sqrt(m2 / n)
}

function resolveTolerance(x: ArrayLike<number>, m: number, r: number | undefined): number {
  if (!Number.isInteger(m) || m < 1) {
    throw new NegentropyError(
      'invalid_config',
      `embedding dimension m must be an integer ≥ 1, got ${m}`,
    )
  }
  if (x.length < m + 2) {
    throw new NegentropyError(
      'insufficient_data',
      `need ≥ m + 2 = ${m + 2} samples, got ${x.length}`,
    )
  }
  const tol = r ?? 0.2 * populationSd(x)
  if (!(tol > 0)) {
    throw new NegentropyError(
      'invalid_config',
      'tolerance r must be > 0 (a constant series has sd 0 — pass r explicitly)',
    )
  }
  return tol
}

/** Count template pairs (Chebyshev distance ≤ r) of length m. `selfMatch` includes i=j. */
function countMatches(
  x: ArrayLike<number>,
  m: number,
  r: number,
  selfMatch: boolean,
): {
  total: number
  perTemplateLogMean: number
} {
  const n = x.length
  const templates = n - m + 1
  let total = 0
  let logSum = 0
  for (let i = 0; i < templates; i++) {
    let count = 0
    for (let j = 0; j < templates; j++) {
      if (!selfMatch && i === j) continue
      let similar = true
      for (let k = 0; k < m; k++) {
        if (Math.abs((x[i + k] as number) - (x[j + k] as number)) > r) {
          similar = false
          break
        }
      }
      if (similar) count++
    }
    total += count
    // ApEn's Φ uses (1/(N−m+1))·Σ ln(count/(N−m+1)); count includes self so ≥ 1
    logSum += Math.log(count / templates)
  }
  return { total, perTemplateLogMean: logSum / templates }
}

/**
 * Sample entropy (Richman & Moorman 2000): the negative log conditional
 * probability that two sequences similar for m points stay similar at m+1,
 * $$\mathrm{SampEn}(m,r)=-\ln\frac{A}{B}$$
 * where B / A count length-m / length-(m+1) template pairs within Chebyshev
 * tolerance r, **excluding self-matches** (so it is unbiased and independent
 * of record length, unlike ApEn). `m` defaults to 2, `r` to 0.2·sd. Lower =
 * more regular/predictable; a sine ≪ white noise. Returns +∞ when no length
 * m+1 matches exist (undefined ratio — a signal too short/irregular to score).
 */
export function sampleEntropy(x: ArrayLike<number>, m = 2, r?: number): number {
  const tol = resolveTolerance(x, m, r)
  const b = countMatches(x, m, tol, false).total
  const a = countMatches(x, m + 1, tol, false).total
  if (b === 0) {
    throw new NegentropyError('insufficient_data', 'no length-m template matches — increase r or n')
  }
  if (a === 0) return Number.POSITIVE_INFINITY
  return -Math.log(a / b)
}

/**
 * Approximate entropy (Pincus 1991):
 * $$\mathrm{ApEn}(m,r)=\Phi_m(r)-\Phi_{m+1}(r),\quad
 *   \Phi_m(r)=\tfrac{1}{N-m+1}\sum_i \ln C_i^m(r)$$
 * with $C_i^m$ the fraction of templates within tolerance r **including the
 * self-match**. Biased and record-length-dependent (that's the self-match
 * cost); `sampleEntropy` is usually preferred, but ApEn is kept for parity
 * with the classical literature. `m` defaults to 2, `r` to 0.2·sd.
 */
export function approximateEntropy(x: ArrayLike<number>, m = 2, r?: number): number {
  const tol = resolveTolerance(x, m, r)
  const phiM = countMatches(x, m, tol, true).perTemplateLogMean
  const phiM1 = countMatches(x, m + 1, tol, true).perTemplateLogMean
  return phiM - phiM1
}
