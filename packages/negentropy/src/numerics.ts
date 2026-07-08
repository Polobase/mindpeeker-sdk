/**
 * Shared numerics for @mindpeeker sibling packages.
 *
 * Re-export barrel behind the `@mindpeeker/negentropy/numerics` subpath. It exposes
 * the package's fixture-validated numerical core — special functions cross-checked
 * against scipy/mpmath to 1e-9..1e-15 relative error (see test/fixtures/special.json
 * and scripts/fixtures/generate.py) — so sibling packages (e.g. @mindpeeker/psi,
 * @mindpeeker/flow) can reuse it instead of duplicating delicate tail-accurate code.
 *
 * What lives here:
 * - Special functions (internal/special.ts): $\ln\Gamma(x)$ via a Lanczos
 *   approximation (Godfrey $g=7$, $n=9$); the regularized incomplete gammas
 *   $P(a,x)=\gamma(a,x)/\Gamma(a)$ and $Q(a,x)=1-P(a,x)$ (series + Lentz continued
 *   fraction, per Numerical Recipes §6.2); $\operatorname{erfc}(x)=Q(\tfrac12,x^2)$;
 *   the standard normal CDF $\Phi(z)$, survival $1-\Phi(z)$, and quantile
 *   $\Phi^{-1}(p)$ (Wichura's AS 241 / PPND16); chi-square CDF/SF/quantile for
 *   df $k$ via $P(k/2, x/2)$, $Q(k/2, x/2)$, and a bracketed log-space Newton.
 * - Compensated accumulation: KahanSum (Kahan 1965 compensated summation, $O(\varepsilon)$
 *   error on long sums) and Welford (Welford 1962 one-pass mean/variance).
 * - Byte/bit utilities (internal/bytes.ts): toBits (MSB-first, the SDK-wide bit
 *   order), concatBytes, and the POPCOUNT per-byte one-bits table.
 *
 * Stability: this is a secondary entry point of @mindpeeker/negentropy and carries
 * the same semver guarantees as the root export — additions are minor, removals or
 * signature changes are major. Deterministic and browser-safe: no I/O, no `node:`
 * builtins, same inputs always produce the same outputs.
 */
export { concatBytes, POPCOUNT, toBits } from './internal/bytes.js'
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
