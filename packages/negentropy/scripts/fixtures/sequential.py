# /// script
# requires-python = ">=3.11"
# dependencies = ["mpmath>=1.3", "numpy>=2", "scipy>=1.13", "arch>=7"]
# ///
"""Reference data for the @mindpeeker/negentropy sequential and GCP statistics.

Run manually (never at test time):

    uv run packages/negentropy/scripts/fixtures/sequential.py

Writes test/fixtures/sequential.json with references that do NOT share code
or formulas' numerical forms with the TypeScript implementation:
- netvar Gamma-mixture ln M_t from the textbook closed form
  S/2 + a ln b − lnΓ(a) + lnΓ(a+t/2) − (a+t/2) ln(b+S/2) (+ ln P ratio for the
  'upper' prior) at 40 digits, and its time-uniform boundaries by 200-step
  mpmath bisection;
- normal-mixture ln M_t and the half-normal boundary likewise;
- Lo–MacKinlay variance ratios from arch.unitroot.VarianceRatio;
- blocking decomposition and lag-z profiles from numpy/scipy.
"""

import json
import platform
import sys
from pathlib import Path

import arch
import mpmath as mp
import numpy as np
import scipy
from arch.unitroot import VarianceRatio
from scipy.stats import chi2, norm

ROOT = Path(__file__).resolve().parents[2]
mp.mp.dps = 40


def as_float(x):
    return float(mp.mpf(x))


# ---------------------------------------------------------------- netvar


def ln_lower_gamma(a, x):
    """ln P(a, x) at 40 digits by the defining series Σ xⁿ/((a+1)…(a+n)).

    Far in the upper tail (Chernoff: Q(a, x) ≤ exp(−a·(r − 1 − ln r)), r = x/a
    > 1) ln P = ln(1 − Q) is 0 to better than 1e-300, so the (slow) series is
    skipped there; mpmath.gammainc stalls for large a on either path.
    """
    a = mp.mpf(a)
    x = mp.mpf(x)
    if x > a:
        r = x / a
        if a * (r - 1 - mp.log(r)) > 700:
            return mp.mpf(0)
    term = mp.mpf(1)
    total = mp.mpf(1)
    n = 0
    while True:
        n += 1
        term *= x / (a + n)
        total += term
        if term < total * mp.mpf("1e-38"):
            break
    return a * mp.log(x) - x - mp.loggamma(a + 1) + mp.log(total)


def ln_m_netvar(t, deviation, a, b, sided):
    t = mp.mpf(t)
    s = t + mp.mpf(deviation)
    a = mp.mpf(a)
    b = mp.mpf(b)
    big_a = a + t / 2
    x = b + s / 2
    value = s / 2 + a * mp.log(b) - mp.loggamma(a) + mp.loggamma(big_a) - big_a * mp.log(x)
    if sided == "upper":
        value += ln_lower_gamma(big_a, x) - ln_lower_gamma(a, b)
    return value


def bisect(f, lo, hi, iterations=200):
    flo = f(lo)
    for _ in range(iterations):
        mid = (lo + hi) / 2
        fm = f(mid)
        if (fm >= 0) == (flo >= 0):
            lo, flo = mid, fm
        else:
            hi = mid
    return (lo + hi) / 2


PRIORS = [(1, 1), (0.5, 2), (10, 10), (3, 0.5)]


def netvar_logm_cases():
    cases = []
    for t in [1, 2, 10, 1000, 1_000_000]:
        root = mp.sqrt(2 * t)
        for deviation in [-t, -t / 2, 0, 3 * root, 10 * root, 4 * t]:
            for a, b in PRIORS:
                for sided in ["two", "upper"]:
                    cases.append(
                        {
                            "t": t,
                            "deviation": as_float(deviation),
                            "a": a,
                            "b": b,
                            "sided": sided,
                            "logM": as_float(ln_m_netvar(t, as_float(deviation), a, b, sided)),
                        }
                    )
    return cases


def netvar_boundary_cases():
    cases = []
    for t in [1, 10, 100, 1000, 100_000]:
        for alpha in [0.05, 0.01, 1e-6]:
            for a, b in [(1, 1), (0.5, 2), (10, 10)]:
                for sided in ["two", "upper"]:
                    threshold = -mp.log(alpha)
                    f = lambda d: ln_m_netvar(t, d, a, b, sided) - threshold  # noqa: E731
                    d_star = -t if sided == "upper" else max(-t, 2 * (a - b))
                    hi = mp.mpf(max(d_star, 0)) + 1
                    while f(hi) < 0:
                        hi *= 2
                    upper = bisect(f, mp.mpf(d_star), hi)
                    lower = None
                    if sided == "two" and d_star > -t and f(mp.mpf(-t)) >= 0:
                        lower = as_float(bisect(f, mp.mpf(-t), mp.mpf(d_star)))
                    cases.append(
                        {
                            "t": t,
                            "alpha": alpha,
                            "a": a,
                            "b": b,
                            "sided": sided,
                            "upper": as_float(upper),
                            "lower": lower,
                        }
                    )
    return cases


# ---------------------------------------------------------------- drift


def ln_m_drift(t, total, lam, sided):
    t = mp.mpf(t)
    total = mp.mpf(total)
    lam = mp.mpf(lam)
    value = mp.log(mp.sqrt(lam / (t + lam))) + total**2 / (2 * (t + lam))
    if sided == "upper":
        value += mp.log(2) + mp.log(mp.ncdf(total / mp.sqrt(t + lam)))
    return value


def drift_cases():
    logm = []
    for t in [1, 10, 1000, 1_000_000]:
        for lam in [1, 100]:
            root = mp.sqrt(t + lam)
            for x in [-50, -5, -1, 0, 1, 3, 20]:
                for sided in ["two", "upper"]:
                    total = as_float(x * root)
                    logm.append(
                        {
                            "t": t,
                            "sum": total,
                            "lambda": lam,
                            "sided": sided,
                            "logM": as_float(ln_m_drift(t, total, lam, sided)),
                        }
                    )
    boundary = []
    for t in [0, 1, 10, 1000, 1_000_000]:
        for lam in [1, 100]:
            for alpha in [0.05, 1e-4]:
                threshold = -mp.log(alpha)
                two = mp.sqrt((t + lam) * mp.log((t + lam) / (lam * mp.mpf(alpha) ** 2)))
                f = lambda s: ln_m_drift(t, s, lam, "upper") - threshold  # noqa: E731
                upper = bisect(f, mp.mpf(0), two * 2)
                boundary.append(
                    {
                        "t": t,
                        "lambda": lam,
                        "alpha": alpha,
                        "two": as_float(two),
                        "upper": as_float(upper),
                    }
                )
    return {"logM": logm, "boundary": boundary}


# ---------------------------------------------------------------- series fixtures


def series():
    rng = np.random.default_rng(20260917)
    iid = rng.standard_normal(1000)
    ar = np.empty(600)
    ar[0] = rng.standard_normal()
    for i in range(1, 600):
        ar[i] = 0.3 * ar[i - 1] + rng.standard_normal()
    return iid, ar


def variance_ratio_cases(iid, ar):
    cases = []
    for name, x, qs in [("iid", iid, [2, 5, 10]), ("ar", ar, [2, 4, 16])]:
        y = np.concatenate([[0.0], np.cumsum(x)])
        for q in qs:
            plain = VarianceRatio(y, lags=q, trend="c", debiased=True, robust=False, overlap=True)
            robust = VarianceRatio(y, lags=q, trend="c", debiased=True, robust=True, overlap=True)
            cases.append(
                {
                    "series": name,
                    "q": q,
                    "ratio": float(plain.vr),
                    "statistic": float(plain.stat),
                    "pValue": float(plain.pvalue),
                    "robustStatistic": float(robust.stat),
                    "robustPValue": float(robust.pvalue),
                }
            )
    return cases


def probit_upper(p):
    return float(norm.isf(p))


def blocking_cases(ar):
    z = ar[:600]
    n = z.size
    energy = float(np.sum(z * z))
    z0 = probit_upper(chi2.sf(energy, n))
    points = []
    for T in [1, 5, 30, 64]:
        blocks = n // T
        bz = z[: blocks * T].reshape(blocks, T).sum(axis=1) / np.sqrt(T)
        statistic = float(np.sum(bz * bz))
        p = float(chi2.sf(statistic, blocks))
        rho = [float(np.dot(z[:-lag], z[lag:]) / energy) for lag in range(1, T)]
        term = float(np.sqrt(2 * n / T**3) * sum((T - l) * r for l, r in zip(range(1, T), rho)))
        points.append(
            {
                "T": T,
                "blocks": blocks,
                "statistic": statistic,
                "pValue": p,
                "z": probit_upper(p),
                "expected": z0 / np.sqrt(T),
                "autocorrelationTerm": term,
            }
        )
    return {"steps": n, "z0": z0, "points": points}


def autocorr_case(ar):
    x = ar
    n = x.size
    c = x - x.mean()
    c0 = float(np.dot(c, c))
    max_lag = 12
    acf = [float(np.dot(c[:-lag], c[lag:]) / c0) for lag in range(1, max_lag + 1)]
    z = [a * np.sqrt(n) for a in acf]
    return {
        "maxLag": max_lag,
        "p": 0.05,
        "acf": acf,
        "z": z,
        "integrated": list(np.cumsum(z)),
        "envelope": [float(norm.isf(0.025) * np.sqrt(lag)) for lag in range(1, max_lag + 1)],
    }


def main():
    iid, ar = series()
    payload = {
        "generator": (
            f"python {platform.python_version()}, mpmath {mp.__version__} (dps {mp.mp.dps}), "
            f"numpy {np.__version__}, scipy {scipy.__version__}, arch {arch.__version__}"
        ),
        "netvarLogM": netvar_logm_cases(),
        "netvarBoundary": netvar_boundary_cases(),
        "drift": drift_cases(),
        "series": {"iid": [float(v) for v in iid], "ar": [float(v) for v in ar]},
        "varianceRatio": variance_ratio_cases(iid, ar),
        "blocking": blocking_cases(ar),
        "autocorrelation": autocorr_case(ar),
    }
    path = ROOT / "test" / "fixtures" / "sequential.json"
    path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {path}", file=sys.stderr)


if __name__ == "__main__":
    main()
