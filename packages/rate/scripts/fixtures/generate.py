# /// script
# requires-python = ">=3.11"
# dependencies = ["scipy>=1.11", "numpy>=1.26"]
# ///
"""Generate authoritative test fixtures for @mindpeeker/rate.

Run manually (never at test time):

    uv run packages/rate/scripts/fixtures/generate.py

Writes JSON files into packages/rate/test/fixtures/. Every fixture embeds the
exact phase vectors it was computed from, so the bun tests never reproduce a
Python PRNG — they only re-check our directional statistics against
scipy.stats.circmean / circvar on identical inputs.
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


def circular_fixture() -> None:
    tau = 2.0 * np.pi
    # A mix of hand vectors and rate-derived phase sets (digits * 2π / 44).
    vectors: list[list[float]] = [
        [0.0],
        [0.0, np.pi],
        [np.pi / 4.0, 3.0 * np.pi / 4.0],
        # base-44 digits [12, 33, 7] -> phases
        [d * tau / 44.0 for d in (12, 33, 7)],
        # base-44 digits [1, 3, 5, 17, 34] (a real Combe rate, 0-based -1)
        [d * tau / 44.0 for d in (0, 2, 4, 16, 33)],
        # clustered near 0.3 rad
        [0.28, 0.31, 0.29, 0.33, 0.30],
        # near-uniform spread (low concentration)
        [k * tau / 8.0 for k in range(8)],
    ]
    cases = []
    for v in vectors:
        arr = np.asarray(v, dtype=float)
        c = float(np.cos(arr).sum())
        s = float(np.sin(arr).sum())
        n = arr.size
        resultant = float(np.hypot(c, s) / n)
        cases.append(
            {
                "phases": v,
                "circmean": float(stats.circmean(arr, high=tau, low=0.0)),
                "circvar": float(stats.circvar(arr, high=tau, low=0.0)),
                "resultant": resultant,
            }
        )
    write("circular.json", {"cases": cases})


if __name__ == "__main__":
    circular_fixture()
