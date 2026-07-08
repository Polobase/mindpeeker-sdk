# /// script
# requires-python = ">=3.11"
# dependencies = ["scipy>=1.11", "numpy>=1.26"]
# ///
"""Generate authoritative test fixtures for @mindpeeker/oracle.

Run manually (never at test time):

    uv run packages/oracle/scripts/fixtures/generate.py

Writes JSON files into packages/oracle/test/fixtures/. The only fixture is
the chi-square critical-value table the uniformity property tests compare
their Pearson statistics against — everything else in this package is exact
integer math with hand-computed expectations.
"""

import json
import platform
from pathlib import Path

import numpy as np
import scipy
from scipy import stats

OUT_DIR = Path(__file__).resolve().parents[2] / "test" / "fixtures"
GENERATOR = f"python {platform.python_version()}, scipy {scipy.__version__}, numpy {np.__version__}"


def write(name: str, payload: dict) -> None:
    payload = {"generator": GENERATOR, **payload}
    path = OUT_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {path}")


def chi2_fixture() -> None:
    # Upper-tail critical values chi2.ppf(1 - alpha, df): a seeded-PRNG
    # uniformity test passes iff its Pearson statistic stays below these.
    alpha = 0.001
    dfs = [3, 15, 23, 63, 77]
    write(
        "chi2-critical.json",
        {
            "alpha": alpha,
            "critical": {str(df): float(stats.chi2.ppf(1 - alpha, df)) for df in dfs},
        },
    )


if __name__ == "__main__":
    chi2_fixture()
