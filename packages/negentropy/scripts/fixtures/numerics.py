# /// script
# requires-python = ">=3.11"
# dependencies = ["mpmath>=1.3"]
# ///
"""Reference data for the @mindpeeker/negentropy numerics core.

Run manually (never at test time), then format the generated TS module:

    uv run packages/negentropy/scripts/fixtures/numerics.py
    bunx biome format --write packages/negentropy/src/internal/temme-coefficients.ts

Writes
- src/internal/temme-coefficients.ts — Temme's d_{k,n} (DLMF §8.12), computed
  with exact rational series arithmetic (no floating point until the final
  shortest-round-trip print);
- test/fixtures/numerics.json — 40-digit mpmath references that do NOT use the
  algorithms under test: the lower incomplete gamma by its defining series at
  high precision (mpmath's own hypergeometric path stalls for large a), chi-square
  quantiles by high-precision bisection in ln x, and the incomplete beta via
  mpmath.betainc (moderate shapes) or exact binomial sums (large integer shapes).
"""

import json
import platform
import sys
from fractions import Fraction as F
from math import comb
from pathlib import Path

import mpmath as mp

ROOT = Path(__file__).resolve().parents[2]
mp.mp.dps = 40

# --------------------------------------------------------------------------
# Temme coefficients
# --------------------------------------------------------------------------

TEMME_K = 10
TEMME_N = 20


def _mul(a, b, n):
    out = [F(0)] * n
    for i, ai in enumerate(a[:n]):
        if ai:
            for j, bj in enumerate(b[: n - i]):
                out[i + j] += ai * bj
    return out


def _inv(a, n):
    out = [F(0)] * n
    out[0] = 1 / a[0]
    for k in range(1, n):
        s = sum((a[j] * out[k - j] for j in range(1, min(k, len(a) - 1) + 1)), F(0))
        out[k] = -s / a[0]
    return out


def _sqrt1(a, n):  # sqrt of a series with a[0] == 1
    out = [F(0)] * n
    out[0] = F(1)
    for k in range(1, n):
        s = a[k] if k < len(a) else F(0)
        s -= sum((out[j] * out[k - j] for j in range(1, k)), F(0))
        out[k] = s / 2
    return out


def temme_coefficients(K=TEMME_K, N=TEMME_N):
    n = N + 2 * K + 4
    # mu = lambda − 1; eta = mu·sqrt(S(mu)), S = 2(mu − ln(1+mu))/mu² = Σ_{j≥2} 2(−1)^j mu^(j−2)/j
    S = [F(2 * (-1) ** j, j) for j in range(2, n + 2)]
    R = _sqrt1(S, n)
    # Lagrange inversion of eta = mu/phi(mu), phi = 1/R: [eta^k] mu = (1/k)[mu^(k−1)] phi^k
    phi = _inv(R, n)
    mu = [F(0)] * n
    power = [F(1)] + [F(0)] * (n - 1)
    for k in range(1, n):
        power = _mul(power, phi, n)
        mu[k] = power[k - 1] / k
    T = mu[1:]  # mu = eta·T(eta)
    inv_t = _inv(T, n - 1)
    d0 = [inv_t[m + 1] for m in range(len(inv_t) - 1)]  # c0 = (1/T − 1)/eta
    # Stirling coefficients g_k of Gamma*(a) = exp(Σ_j B_2j/(2j(2j−1)) a^(1−2j))
    B = [F(0)] * (2 * K + 3)
    B[0] = F(1)
    for m in range(1, len(B)):
        B[m] = -sum((comb(m + 1, k) * B[k] for k in range(m)), F(0)) / (m + 1)
    L = [F(0)] * (K + 1)
    for j in range(1, K + 1):
        if 2 * j - 1 <= K:
            L[2 * j - 1] = B[2 * j] / (2 * j * (2 * j - 1))
    g = [F(1)] + [F(0)] * K
    for k in range(1, K + 1):
        g[k] = sum((j * L[j] * g[k - j] for j in range(1, k + 1)), F(0)) / k
    d = [d0]
    for k in range(1, K):
        prev = d[-1]
        d.append([(-1) ** k * g[k] * d0[m] + (m + 2) * prev[m + 2] for m in range(len(prev) - 2)])
    return [[float(v) for v in row[:N]] for row in d]


def write_temme_module():
    rows = temme_coefficients()
    body = "\n".join("  [" + ", ".join(repr(v) for v in row) + "]," for row in rows)
    header = f"""/**
 * Coefficients d_{{k,n}} of Temme's uniform asymptotic expansion of the
 * regularized incomplete gamma function (DLMF §8.12; Temme 1979; DiDonato &
 * Morris 1986), truncated to k < {TEMME_K} and n < {TEMME_N}:
 *
 * $$c_k(\\eta) = \\sum_n d_{{k,n}}\\,\\eta^n,\\qquad
 *   d_{{0,n}} = [\\eta^{{n+1}}]\\,\\frac{{\\eta}}{{\\lambda-1}},\\qquad
 *   d_{{k,n}} = (-1)^k g_k\\, d_{{0,n}} + (n+2)\\, d_{{k-1,n+2}}$$
 *
 * where $\\tfrac12\\eta^2 = \\lambda - 1 - \\ln\\lambda$ and $g_k$ are the Stirling
 * coefficients of $\\Gamma^*(a)$ (1, 1/12, 1/288, −139/51840, …). Generated with
 * exact rational series arithmetic by `scripts/fixtures/numerics.py` and printed
 * as shortest round-trip float64 literals. Pure data — no imports.
 */
export const TEMME_D: readonly (readonly number[])[] = [
"""
    path = ROOT / "src" / "internal" / "temme-coefficients.ts"
    path.write_text(header + body + "\n]\n")
    print(f"wrote {path}")


# --------------------------------------------------------------------------
# Fixtures
# --------------------------------------------------------------------------


def lower_gamma_series(a, x):
    """P(a, x) by its defining series Σ x^n/((a+1)…(a+n)) at 40 digits."""
    a = mp.mpf(a)
    x = mp.mpf(x)
    term = mp.mpf(1)
    total = mp.mpf(1)
    n = 0
    while True:
        n += 1
        term *= x / (a + n)
        total += term
        if term < total * mp.mpf("1e-38"):
            break
    return mp.exp(a * mp.log(x) - x - mp.loggamma(a + 1)) * total


def gamma_pq(a, x):
    if x < a:
        p = lower_gamma_series(a, x)
        return p, 1 - p
    q = mp.gammainc(mp.mpf(a), mp.mpf(x), mp.inf, regularized=True)
    return 1 - q, q


def as_float(v):
    return float(v) if v > mp.mpf("1e-320") else 0.0


def gamma_large_cases():
    cases = []
    for a in [1e5, 1841898.0, 2592000.0, 5e6, 2e7, 5e8]:
        s = float(mp.sqrt(a))
        xs = sorted({a + k * s for k in [-20, -8, -3, -0.5, 0, 0.5, 3, 8, 20]} | {0.7 * a, 1.3 * a})
        for x in xs:
            p, q = gamma_pq(a, x)
            cases.append({"a": a, "x": x, "p": as_float(p), "q": as_float(q)})
    return cases


def chi2_sf_large_df_cases():
    cases = []
    gcp = 60 * 86400  # one day of a 60-source network at 1 Hz
    for df, stats in [
        (gcp, [gcp - 4399, gcp - 3000, gcp - 500, gcp, gcp + 1, gcp + 2, gcp + 100, gcp + 10000]),
        (10_000_000, [10_000_000 - 3 * 4472.136, 10_000_000, 10_000_000 + 3 * 4472.136]),
        (1_000_000_000, [1_000_000_000 - 44721.36, 1_000_000_000, 1_000_000_000 + 44721.36]),
    ]:
        for x in stats:
            _, q = gamma_pq(df / 2, x / 2)
            cases.append({"x": float(x), "k": df, "value": as_float(q)})
    return cases


def _log_tail(x, k, lower):
    a = mp.mpf(k) / 2
    y = x / 2
    if lower:
        return mp.log(lower_gamma_series(a, y)) if y < a else mp.log(1 - gamma_pq(a, y)[1])
    return mp.log(gamma_pq(a, y)[1]) if y >= a else mp.log(1 - lower_gamma_series(a, y))


def chi2_ppf_cases():
    cases = []
    probs = [1e-300, 1e-100, 1e-12, 1e-8, 1e-6, 1e-4, 0.01, 0.3, 0.5, 0.7, 0.99, 0.999999, 0.999999999999]
    for k in [1, 2, 5, 10, 100, 1000, 100000]:
        for pf in probs:
            p = mp.mpf(pf)  # the exact double the test passes
            lower = p <= mp.mpf("0.5")
            target = mp.log(p) if lower else mp.log(1 - p)
            sign = 1 if lower else -1

            def g(lx):
                return sign * (_log_tail(mp.exp(lx), k, lower) - target)

            lo = hi = mp.log(mp.mpf(k))
            while g(lo) > 0:
                lo -= 4
            while g(hi) < 0:
                hi += 1
            while hi - lo > mp.mpf("1e-30"):
                mid = (lo + hi) / 2
                if g(mid) > 0:
                    hi = mid
                else:
                    lo = mid
            cases.append({"p": pf, "k": k, "value": as_float(mp.exp((lo + hi) / 2))})
    return cases


def binomial_upper_sum(n, x, a):
    """P(Bin(n, x) ≥ a) summed over the ±60σ window at 40 digits (exact tail beyond is < 1e-700)."""
    x = mp.mpf(x)
    mean = n * x
    sd = mp.sqrt(n * x * (1 - x))
    lo = max(a, int(mp.floor(mean - 60 * sd)))
    hi = min(n, int(mp.ceil(mean + 60 * sd)))
    if lo > hi:
        return mp.mpf(0)
    log_pmf = mp.loggamma(n + 1) - mp.loggamma(lo + 1) - mp.loggamma(n - lo + 1)
    log_pmf += lo * mp.log(x) + (n - lo) * mp.log(1 - x)
    term = mp.exp(log_pmf)
    total = mp.mpf(0)
    for j in range(lo, hi + 1):
        total += term
        term *= mp.mpf(n - j) / (j + 1) * x / (1 - x)
    return total


def beta_inc_cases():
    cases = []
    for a, b in [(0.5, 0.5), (1, 3), (2.5, 7), (7, 2.5), (10, 10), (50, 50), (0.1, 30), (1000, 1000)]:
        for x in [1e-6, 0.01, 0.2, 0.45, 0.5, 0.8, 0.999]:
            v = mp.betainc(mp.mpf(a), mp.mpf(b), 0, mp.mpf(x), regularized=True)
            cases.append({"a": a, "b": b, "x": x, "value": as_float(v)})
    # large integer shapes: I_x(a, b) = P(Bin(a + b − 1, x) ≥ a)
    for a, b in [(50_000, 50_000), (1_000_000, 1_000_000), (3, 999_998)]:
        n = a + b - 1
        mode = a / (a + b)
        sd = float(mp.sqrt(mode * (1 - mode) / (a + b)))
        for z in [-8, -2, 0, 2, 8]:
            x = mode + z * sd
            if 0 < x < 1:
                cases.append({"a": a, "b": b, "x": x, "value": as_float(binomial_upper_sum(n, x, a))})
    return cases


def main():
    write_temme_module()
    payload = {
        "generator": f"python {platform.python_version()}, mpmath {mp.__version__} (dps {mp.mp.dps})",
        "gammaLarge": gamma_large_cases(),
        "chi2SfLargeDf": chi2_sf_large_df_cases(),
        "chi2Ppf": chi2_ppf_cases(),
        "betaInc": beta_inc_cases(),
        "chi2Sf255": as_float(gamma_pq(mp.mpf(255) / 2, mp.mpf(255) / 2)[1]),
    }
    path = ROOT / "test" / "fixtures" / "numerics.json"
    path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {path}", file=sys.stderr)


if __name__ == "__main__":
    main()
