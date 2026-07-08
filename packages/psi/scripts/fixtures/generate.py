# /// script
# requires-python = ">=3.11"
# dependencies = ["scipy>=1.11", "numpy>=1.26"]
# ///
"""Generate authoritative test fixtures for @mindpeeker/psi.

Run manually (never at test time):

    uv run packages/psi/scripts/fixtures/generate.py

Writes JSON files into packages/psi/test/fixtures/.
"""

import json
import math
import platform
from pathlib import Path

import numpy as np
import scipy
from scipy.special import betaln

OUT_DIR = Path(__file__).resolve().parents[2] / "test" / "fixtures"
GENERATOR = f"python {platform.python_version()}, scipy {scipy.__version__}, numpy {np.__version__}"


def write(name: str, payload: dict) -> None:
    payload = {"generator": GENERATOR, **payload}
    path = OUT_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {path}")


def bayes_fixture() -> None:
    # BF10 for k successes in n Bernoulli trials, H1: p ~ Beta(a, b) vs H0: p = 1/2:
    #   ln BF10 = betaln(k + a, n - k + b) - betaln(a, b) + n ln 2
    cases = []
    for k, n in [
        (0, 1),
        (1, 1),
        (1, 2),
        (0, 10),
        (3, 10),
        (5, 10),
        (7, 10),
        (10, 10),
        (52, 100),
        (80, 100),
        (480, 1000),
        (500, 1000),
        (520, 1000),
        (550, 1000),
        (5100, 10000),
    ]:
        for a, b in [(1.0, 1.0), (0.5, 0.5), (2.0, 2.0), (3.0, 1.0)]:
            ln_bf = float(betaln(k + a, n - k + b) - betaln(a, b) + n * math.log(2.0))
            cases.append(
                {
                    "k": k,
                    "n": n,
                    "a": a,
                    "b": b,
                    "lnBf10": ln_bf,
                    "bf10": float(math.exp(ln_bf)) if ln_bf < 700 else None,
                }
            )
    write("bayes.json", {"cases": cases})


if __name__ == "__main__":
    bayes_fixture()
