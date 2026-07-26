import { NegentropyError } from '../errors.js'

/**
 * Sample autocorrelation function (ACF) of a real series, lags 0…maxLag:
 * $$\hat\rho(\ell) = \frac{\sum_{t=1}^{n-\ell}(x_t-\bar x)(x_{t+\ell}-\bar x)}
 *                        {\sum_{t=1}^{n}(x_t-\bar x)^2}$$
 * (the biased/1-over-n normalization, standard for ACF plots — the estimate
 * for which the ±1.96/√n white-noise band applies). `out[0] = 1` always.
 * `maxLag` defaults to min(n − 1, 40). White noise sits inside ±1.96/√n at
 * every nonzero lag ~95% of the time; serial dependence shows as lags poking
 * out of that band.
 */
export function autocorrelation(x: ArrayLike<number>, maxLag?: number): Float64Array {
  const n = x.length
  if (n < 2) {
    throw new NegentropyError('insufficient_data', `autocorrelation needs ≥ 2 samples, got ${n}`)
  }
  const lags = maxLag ?? Math.min(n - 1, 40)
  if (!Number.isInteger(lags) || lags < 1 || lags >= n) {
    throw new NegentropyError(
      'invalid_config',
      `maxLag must be an integer in [1, n), got ${lags} for n=${n}`,
    )
  }
  let mean = 0
  for (let i = 0; i < n; i++) mean += x[i] as number
  mean /= n
  const centered = new Float64Array(n)
  let c0 = 0
  for (let i = 0; i < n; i++) {
    const d = (x[i] as number) - mean
    centered[i] = d
    c0 += d * d
  }
  if (!(c0 > 0)) {
    throw new NegentropyError(
      'insufficient_data',
      'series is constant — autocorrelation is undefined',
    )
  }
  const out = new Float64Array(lags + 1)
  out[0] = 1
  for (let lag = 1; lag <= lags; lag++) {
    let acc = 0
    for (let t = 0; t + lag < n; t++) acc += (centered[t] as number) * (centered[t + lag] as number)
    out[lag] = acc / c0
  }
  return out
}
