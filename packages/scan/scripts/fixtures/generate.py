# /// script
# requires-python = ">=3.11"
# dependencies = ["scipy>=1.11", "numpy>=1.26"]
# ///
"""Generate authoritative test fixtures for @mindpeeker/scan.

Run manually (never at test time):

    uv run packages/scan/scripts/fixtures/generate.py

Writes JSON files into packages/scan/test/fixtures/. The deviation fixture
cross-checks the honest null model (p0 = 1/2): the two-sided z p-value against
scipy.stats.norm and the Bayes factor against scipy.special.betaln.
"""

import json
import math
import platform
from pathlib import Path

import numpy as np
import scipy
from scipy.special import betaln
from scipy.stats import norm

OUT_DIR = Path(__file__).resolve().parents[2] / "test" / "fixtures"
GENERATOR = f"python {platform.python_version()}, scipy {scipy.__version__}, numpy {np.__version__}"

P0 = 0.5


def write(name: str, payload: dict) -> None:
    payload = {"generator": GENERATOR, **payload}
    path = OUT_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {path}")


def deviation_fixture() -> None:
    # Per item: z = (k - N p0)/sqrt(N p0 (1-p0)); two-sided p = 2 * norm.sf(|z|);
    # BF10 against H0: p = 1/2 with a Beta(a, b) prior on H1.
    cases = []
    for k, n in [
        (50, 100),
        (55, 100),
        (60, 100),
        (75, 100),
        (90, 100),
        (100, 100),
        (128, 256),
        (150, 256),
        (200, 400),
        (400, 400),
        (500, 1000),
        (550, 1000),
    ]:
        z = (k - n * P0) / math.sqrt(n * P0 * (1.0 - P0))
        p = float(min(1.0, 2.0 * norm.sf(abs(z))))
        for a, b in [(1.0, 1.0), (8.0, 8.0)]:
            ln_bf = float(betaln(k + a, n - k + b) - betaln(a, b) + n * math.log(2.0))
            cases.append(
                {
                    "k": k,
                    "n": n,
                    "a": a,
                    "b": b,
                    "z": z,
                    "p": p,
                    "lnBf10": ln_bf,
                    "bf10": float(math.exp(ln_bf)) if ln_bf < 700 else None,
                }
            )
    write("deviation.json", {"p0": P0, "cases": cases})


if __name__ == "__main__":
    deviation_fixture()
