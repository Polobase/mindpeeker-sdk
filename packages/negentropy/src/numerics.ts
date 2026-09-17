/**
 * Shared numerics for @mindpeeker sibling packages.
 *
 * Re-export barrel behind the `@mindpeeker/negentropy/numerics` subpath. It exposes
 * the package's fixture-validated numerical core so sibling packages (e.g.
 * @mindpeeker/psi, @mindpeeker/field, @mindpeeker/scan) reuse it instead of
 * duplicating delicate tail-accurate code. Reference values come from mpmath
 * (40-digit) and scipy, plus exact BigInt enumeration for binomial tails and
 * APT cutoffs — see test/fixtures/{special,numerics,health}.json and
 * scripts/fixtures/.
 *
 * What lives here:
 * - Gamma family (internal/gamma.ts, internal/special.ts): $\ln\Gamma(x)$ (Lanczos,
 *   Godfrey $g=7$, $n=9$); the regularized incomplete gammas
 *   $P(a,x)=\gamma(a,x)/\Gamma(a)$ and $Q(a,x)=1-P(a,x)$ — series + Lentz continued
 *   fraction (Numerical Recipes §6.2) and, for $a \ge 100$ near the transition
 *   $|x-a| < 0.3a$, Temme's uniform asymptotic expansion (DLMF §8.12), so the cost
 *   is O(1) in $a$ and χ² df up to $10^9$ work (~1e-13 relative error);
 *   $\mathrm{erfc}(x)=Q(\tfrac12,x^2)$; the standard normal CDF $\Phi(z)$, survival
 *   $1-\Phi(z)$, and quantile $\Phi^{-1}(p)$ (Wichura's AS 241 / PPND16); chi-square
 *   CDF/SF via $P(k/2, x/2)$, $Q(k/2, x/2)$ and a quantile by Newton in $\ln x$
 *   (relative accuracy in both tails, e.g. `chi2Ppf(1e-12, 1)` = 1.5708e-24).
 * - Beta family (internal/beta.ts): $\ln B(a,b)$, the regularized incomplete beta
 *   $I_x(a,b)$ (Lentz continued fraction, NR §6.4) and its quantile `betaPpf`.
 * - Binomial (internal/binomial.ts): pmf (Loader's saddle-point algorithm), CDF
 *   $P(X \le k) = I_{1-p}(n-k, k+1)$ and survival $P(X > k) = I_p(k+1, n-k)$.
 * - SP 800-90B §4.4 health-test cutoffs (internal/health-cutoffs.ts): `rctCutoff`
 *   and the exact log-space `aptCutoff` (also exported from the root barrel).
 * - Compensated accumulation: KahanSum (Neumaier's 1974 variant of Kahan
 *   summation — $O(\varepsilon)$ error on long sums, correct when a term exceeds
 *   the running sum) and Welford (Welford 1962 one-pass mean/variance).
 * - Byte/bit utilities (internal/bytes.ts): toBits (MSB-first, the SDK-wide bit
 *   order), concatBytes, and the POPCOUNT per-byte one-bits table.
 *
 * Errors: invalid arguments (NaN, out-of-domain) throw
 * `NegentropyError('invalid_config')`; an iteration that fails to converge throws
 * `NegentropyError('numerical')`. Infinite arguments return exact limits
 * (`gammaQ(a, ∞) = 0`, `erfc(−∞) = 2`, `normSf(∞) = 0`, `chi2Sf(∞, k) = 0`).
 *
 * Stability: this is a secondary entry point of @mindpeeker/negentropy and carries
 * the same semver guarantees as the root export — additions are minor, removals or
 * signature changes are major. Deterministic and browser-safe: no I/O, no `node:`
 * builtins, same inputs always produce the same outputs.
 */
export { betaInc, betaPpf, lnBeta } from './internal/beta.js'
export { binomialCdf, binomialPmf, binomialSf } from './internal/binomial.js'
export { concatBytes, POPCOUNT, toBits } from './internal/bytes.js'
export { aptCutoff, rctCutoff } from './internal/health-cutoffs.js'
export { KahanSum } from './internal/kahan.js'
export {
  chi2Cdf,
  chi2Ppf,
  chi2Sf,
  erfc,
  gammaP,
  gammaQ,
  lnGamma,
  normCdf,
  normPpf,
  normSf,
} from './internal/special.js'
export { Welford } from './internal/welford.js'
