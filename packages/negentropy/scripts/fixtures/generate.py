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


if __name__ == "__main__":
    special_fixture()
    gaussian_constants_fixture()
    moments_fixture()
    vasicek_fixture()
    health_fixture()
