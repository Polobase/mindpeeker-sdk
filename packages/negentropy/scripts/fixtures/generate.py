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
    # E[G(nu)] and Var[G(nu)] for nu ~ N(0,1), the null constants of the
    # Hyvärinen negentropy contrasts. logcosh has no closed form.
    def gauss_expect(f):
        return mpmath.quad(
            lambda x: f(x) * mpmath.exp(-x * x / 2) / mpmath.sqrt(2 * mpmath.pi),
            [-mpmath.inf, 0, mpmath.inf],
        )

    e_logcosh = gauss_expect(lambda x: mpmath.log(mpmath.cosh(x)))
    e_logcosh_sq = gauss_expect(lambda x: mpmath.log(mpmath.cosh(x)) ** 2)
    var_logcosh = e_logcosh_sq - e_logcosh**2

    e_exp = gauss_expect(lambda x: -mpmath.exp(-x * x / 2))
    e_exp_sq = gauss_expect(lambda x: mpmath.exp(-x * x))
    var_exp = e_exp_sq - e_exp**2

    # closed forms to cross-check: E = −1/√2, Var = 1/√3 − 1/2
    assert abs(e_exp + 1 / mpmath.sqrt(2)) < mpmath.mpf("1e-25"), e_exp
    assert abs(var_exp - (1 / mpmath.sqrt(3) - mpmath.mpf(1) / 2)) < mpmath.mpf("1e-25"), var_exp

    write(
        "gaussian-constants.json",
        {
            "logcosh": {"mean": float(e_logcosh), "variance": float(var_logcosh)},
            "exp": {"mean": float(e_exp), "variance": float(var_exp)},
        },
    )


if __name__ == "__main__":
    special_fixture()
    gaussian_constants_fixture()
