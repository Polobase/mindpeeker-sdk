# /// script
# requires-python = ">=3.11"
# dependencies = ["scipy>=1.11", "numpy>=1.26", "mpmath>=1.3"]
# ///
"""Generate authoritative test fixtures for @mindpeeker/negentropy.

Run manually (never at test time):

    uv run packages/negentropy/scripts/fixtures/generate.py

Writes JSON files into packages/negentropy/test/fixtures/. Fixtures that
depend on random samples embed the samples themselves — bun tests never
reproduce a Python PRNG.
"""

import json
import platform
from pathlib import Path

import mpmath
import numpy as np
import scipy
from scipy import special, stats

OUT_DIR = Path(__file__).resolve().parents[2] / "test" / "fixtures"
GENERATOR = f"python {platform.python_version()}, scipy {scipy.__version__}, numpy {np.__version__}, mpmath {mpmath.mp.__class__.__module__.split('.')[0]} {mpmath.__version__}"

mpmath.mp.dps = 30


def write(name: str, payload: dict) -> None:
    payload = {"generator": GENERATOR, **payload}
    path = OUT_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {path}")


def special_fixture() -> None:
    # scipy (Cephes/Boost) is the accuracy reference here; mpmath's hypergeometric
    # path fails to converge for large a.
    gamma_cases = []
    for a in [0.5, 1.0, 2.5, 7.5, 50.0, 500.0, 7500.0, 12000.0]:
        for ratio in [0.1, 0.5, 0.9, 1.0, 1.02, 1.1, 2.0, 5.0]:
            x = a * ratio
            p = float(special.gammainc(a, x))
            q = float(special.gammaincc(a, x))
            gamma_cases.append({"a": a, "x": x, "p": p, "q": q})

    erfc_cases = [
        {"x": x, "value": float(mpmath.erfc(x))}
        for x in [-2.0, -1.0, -0.5, 0.0, 0.5, 1.0, 2.0, 5.0, 10.0]
    ]

    norm_sf_cases = [
        {"z": z, "value": float(mpmath.ncdf(-z))}
        for z in [-3.0, -1.5, 0.0, 0.5, 1.0, 1.959963984540054, 3.0, 6.0, 8.0]
    ]

    norm_ppf_cases = [
        {"p": p, "value": float(stats.norm.ppf(p))}
        for p in [1e-10, 1e-4, 0.001, 0.025, 0.05, 0.5, 0.6, 0.975, 0.999, 0.999999]
    ]

    chi2_sf_cases = [
        {"x": x, "k": k, "value": float(stats.chi2.sf(x, k))}
        for x, k in [
            (3.841458820694124, 1),
            (0.1, 2),
            (5.0, 2),
            (18.307038053275146, 10),
            (124.34, 100),
            (1050.0, 1000),
            # GCP 9/11 formal analysis triple (Nelson): chi-square 15332 on 15000 df
            (15332.0, 15000),
        ]
    ]

    chi2_ppf_cases = [
        {"p": p, "k": k, "value": float(stats.chi2.ppf(p, k))}
        for p in [0.05, 0.5, 0.95, 0.999]
        for k in [1, 2, 10, 100, 1000, 15000]
    ]

    write(
        "special.json",
        {
            "gammainc": gamma_cases,
            "erfc": erfc_cases,
            "normSf": norm_sf_cases,
            "normPpf": norm_ppf_cases,
            "chi2Sf": chi2_sf_cases,
            "chi2Ppf": chi2_ppf_cases,
        },
    )


def gaussian_constants_fixture() -> None:
    # Null constants of the Hyvärinen negentropy contrasts for nu ~ N(0,1):
    # E[G(nu)], Var[G(nu)], and — the one that actually calibrates the z
    # detector — the DELTA-METHOD variance of sqrt(n)·(mean G(y) − E[G(nu)])
    # under empirical standardization:
    #   nullVariance = Var[G(nu) − (b/2)(nu² − 1)],  b = E[nu·G'(nu)]
    # (the mean-correction term E[G']·nu vanishes: G' is odd for both Gs).
    # For logcosh this is ~34× smaller than Var[G] — standardization removes
    # G's quadratic component almost entirely.
    def gauss_expect(f):
        return mpmath.quad(
            lambda x: f(x) * mpmath.exp(-x * x / 2) / mpmath.sqrt(2 * mpmath.pi),
            [-mpmath.inf, 0, mpmath.inf],
        )

    def constants(g, g_prime):
        e_g = gauss_expect(g)
        var_g = gauss_expect(lambda x: g(x) ** 2) - e_g**2
        b = gauss_expect(lambda x: x * g_prime(x))
        null_var = gauss_expect(lambda x: (g(x) - e_g - (b / 2) * (x * x - 1)) ** 2)
        return e_g, var_g, b, null_var

    e_lc, var_lc, b_lc, null_lc = constants(
        lambda x: mpmath.log(mpmath.cosh(x)), lambda x: mpmath.tanh(x)
    )
    e_ex, var_ex, b_ex, null_ex = constants(
        lambda x: -mpmath.exp(-x * x / 2), lambda x: x * mpmath.exp(-x * x / 2)
    )

    # closed forms to cross-check: E = −1/√2, Var = 1/√3 − 1/2, b = 1/(2√2)
    assert abs(e_ex + 1 / mpmath.sqrt(2)) < mpmath.mpf("1e-25"), e_ex
    assert abs(var_ex - (1 / mpmath.sqrt(3) - mpmath.mpf(1) / 2)) < mpmath.mpf("1e-25"), var_ex
    assert abs(b_ex - 1 / (2 * mpmath.sqrt(2))) < mpmath.mpf("1e-25"), b_ex

    write(
        "gaussian-constants.json",
        {
            "logcosh": {
                "mean": float(e_lc),
                "variance": float(var_lc),
                "b": float(b_lc),
                "nullVariance": float(null_lc),
            },
            "exp": {
                "mean": float(e_ex),
                "variance": float(var_ex),
                "b": float(b_ex),
                "nullVariance": float(null_ex),
            },
        },
    )


def moments_fixture() -> None:
    # Stored samples + scipy population (biased) moments of the standardized
    # data, plus the contrast means the TS estimators must reproduce.
    rng = np.random.default_rng(20260708)
    cases = []
    for label, sample in [
        ("normal64", rng.standard_normal(64)),
        ("uniform64", rng.uniform(-1, 1, 64)),
        ("exponential64", rng.exponential(1.0, 64)),
        ("mixed200", np.concatenate([rng.standard_normal(100), rng.exponential(1.0, 100)])),
    ]:
        x = np.asarray(sample, dtype=np.float64)
        y = (x - x.mean()) / x.std()  # population sd — the TS standardization convention
        skew = float(stats.skew(x, bias=True))
        exkurt = float(stats.kurtosis(x, fisher=True, bias=True))
        cases.append(
            {
                "label": label,
                "samples": x.tolist(),
                "skew": skew,
                "exkurt": exkurt,
                "jMoment": skew**2 / 12 + exkurt**2 / 48,
                "meanLogcosh": float(np.mean(np.log(np.cosh(y)))),
                "meanExp": float(np.mean(-np.exp(-(y**2) / 2))),
            }
        )
    write("moments.json", {"cases": cases})


def vasicek_fixture() -> None:
    rng = np.random.default_rng(19441945)
    cases = []
    for label, sample in [
        ("normal500", rng.standard_normal(500)),
        ("uniform500", rng.uniform(0, 1, 500)),
        ("exponential500", rng.exponential(1.0, 500)),
        ("normal50", rng.standard_normal(50)),
    ]:
        x = np.asarray(sample, dtype=np.float64)
        n = len(x)
        default_m = int(np.floor(np.sqrt(n) + 0.5))
        for m in sorted({default_m, 3, 15}):
            cases.append(
                {
                    "label": label,
                    "samples": x.tolist(),
                    "m": m,
                    "entropy": float(
                        stats.differential_entropy(x, window_length=m, method="vasicek")
                    ),
                }
            )
    write("vasicek.json", {"cases": cases})


def health_fixture() -> None:
    # SP 800-90B §4.4.2 APT cutoffs cross-checked against the exact binomial
    # quantile: 1 + smallest k with P(Bin(W, 2^-H) <= k) >= 1 - 2^-20.
    cases = []
    for h in [0.3, 0.5, 1.0, 2.0, 4.0, 6.5, 8.0]:
        for w in [512, 1024]:
            cutoff = 1 + int(stats.binom.ppf(1 - 2**-20, w, 2**-h))
            cases.append({"h": h, "windowSize": w, "cutoff": cutoff})
    write("health.json", {"apt": cases})


def _acf_biased(x, maxlag):
    x = np.asarray(x, dtype=np.float64)
    n = len(x)
    xm = x - x.mean()
    c0 = float(np.sum(xm * xm))
    return [float(np.sum(xm[: n - lag] * xm[lag:]) / c0) for lag in range(maxlag + 1)]


def _spectral_entropy(x):
    psd = np.abs(np.fft.rfft(np.asarray(x, dtype=np.float64))) ** 2  # k = 0..n//2
    p = psd / psd.sum()
    p = p[p > 0]
    return float(-np.sum(p * np.log2(p)))


def _spectral_test(bits):
    n = len(bits)
    s = 2 * np.asarray(bits, dtype=np.float64) - 1
    mags = np.abs(np.fft.fft(s))[: n // 2]  # k = 0..n//2 - 1
    threshold = np.sqrt(np.log(1 / 0.05) * n)
    n1 = int(np.sum(mags < threshold))
    n0 = 0.95 * (n / 2)
    d = (n1 - n0) / np.sqrt(n * 0.95 * 0.05 / 4)
    return float(d), float(special.erfc(abs(d) / np.sqrt(2)))


def _phi(x, m, r, self_match):
    """Richman–Moorman template-match counter (Chebyshev ≤ r)."""
    n = len(x)
    templates = n - m + 1
    total = 0
    logsum = 0.0
    for i in range(templates):
        count = 0
        for j in range(templates):
            if not self_match and i == j:
                continue
            d = max(abs(x[i + k] - x[j + k]) for k in range(m))
            if d <= r:
                count += 1
        total += count
        if self_match:
            logsum += np.log(count / templates)
    return total, (logsum / templates if self_match else None)


def _sampen(x, m, r):
    b, _ = _phi(x, m, r, False)
    a, _ = _phi(x, m + 1, r, False)
    return float(-np.log(a / b))


def _apen(x, m, r):
    _, phim = _phi(x, m, r, True)
    _, phim1 = _phi(x, m + 1, r, True)
    return float(phim - phim1)


def estimators_fixture() -> None:
    rng = np.random.default_rng(20260726)

    # autocorrelation (biased / c0 normalization) — white noise and an AR(1)
    ar1 = np.zeros(400)
    e = rng.standard_normal(400)
    for t in range(1, 400):
        ar1[t] = 0.6 * ar1[t - 1] + e[t]
    acf_cases = [
        {"label": "normal300", "samples": rng.standard_normal(300).tolist(), "maxLag": 20},
        {"label": "ar1-0.6", "samples": ar1.tolist(), "maxLag": 20},
    ]
    for c in acf_cases:
        c["acf"] = _acf_biased(c["samples"], c["maxLag"])

    # spectral entropy — white noise, a pure sinusoid, and a noisy sinusoid
    t = np.arange(1024)
    sine = np.sin(2 * np.pi * 5 * t / 1024)
    spec_entropy_cases = [
        {"label": "white1024", "samples": rng.standard_normal(1024).tolist()},
        {"label": "sine1024", "samples": sine.tolist()},
        {"label": "noisy-sine", "samples": (sine + 0.5 * rng.standard_normal(1024)).tolist()},
    ]
    for c in spec_entropy_cases:
        c["entropy"] = _spectral_entropy(c["samples"])

    # NIST SP 800-22 spectral test — a random bit block, full statistic + p
    bits = rng.integers(0, 2, 4096)
    d, p = _spectral_test(bits)
    spectral_test_cases = [{"label": "random4096", "bits": bits.tolist(), "d": d, "pValue": p}]

    # sample / approximate entropy — cross-language Richman–Moorman reference
    samp_cases = []
    for label, x in [
        ("white200", rng.standard_normal(200)),
        ("sine200", np.sin(np.arange(200) / 4.0)),
    ]:
        x = np.asarray(x, dtype=np.float64)
        r = 0.2 * float(np.std(x))  # ddof=0, matches the TS populationSd default
        samp_cases.append(
            {
                "label": label,
                "samples": x.tolist(),
                "m": 2,
                "r": r,
                "sampleEntropy": _sampen(x, 2, r),
                "approximateEntropy": _apen(x, 2, r),
            }
        )

    write(
        "estimators.json",
        {
            "autocorrelation": acf_cases,
            "spectralEntropy": spec_entropy_cases,
            "spectralTest": spectral_test_cases,
            "sampleApprox": samp_cases,
        },
    )


if __name__ == "__main__":
    special_fixture()
    gaussian_constants_fixture()
    moments_fixture()
    vasicek_fixture()
    health_fixture()
    estimators_fixture()
