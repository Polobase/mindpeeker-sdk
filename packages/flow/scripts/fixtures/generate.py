# /// script
# requires-python = ">=3.11"
# dependencies = ["pyinform>=0.2", "numpy>=1.26"]
# ///
"""Generate authoritative cross-check fixtures for @mindpeeker/flow.

Run manually (never at test time):

    uv run packages/flow/scripts/fixtures/generate.py

PyInform ships only an x86_64 dylib; on Apple Silicon run it under Rosetta:

    uv run --python cpython-3.11-macos-x86_64-none packages/flow/scripts/fixtures/generate.py

Writes JSON files into packages/flow/test/fixtures/. Every fixture embeds its
symbol sequences — bun tests never reproduce a Python PRNG. The reference
implementation is PyInform (the inform C library): plug-in, base-2
transfer entropy with destination history k and a single source symbol at
lag 1, matching this package's (k, l=1, u=1) estimator exactly.
"""

import json
import platform
from importlib.metadata import version
from pathlib import Path

import numpy as np
from pyinform.blockentropy import block_entropy
from pyinform.mutualinfo import mutual_info
from pyinform.transferentropy import transfer_entropy

OUT_DIR = Path(__file__).resolve().parents[2] / "test" / "fixtures"
GENERATOR = (
    f"python {platform.python_version()}, pyinform {version('pyinform')}, numpy {np.__version__}"
)


def write(name: str, payload: dict) -> None:
    payload = {"generator": GENERATOR, **payload}
    path = OUT_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {path}")


def coupled_pair(rng, n: int, alphabet: int, coupling: float):
    """y copies x's previous symbol with probability `coupling`, else is uniform."""
    x = rng.integers(0, alphabet, size=n)
    y = np.empty(n, dtype=np.int64)
    y[0] = rng.integers(0, alphabet)
    for t in range(1, n):
        y[t] = x[t - 1] if rng.random() < coupling else rng.integers(0, alphabet)
    return x, y


def te_fixture() -> None:
    rng = np.random.default_rng(20260708)
    pairs = [
        ("binary-coupled-0.9", *coupled_pair(rng, 1000, 2, 0.9)),
        ("binary-independent", rng.integers(0, 2, 800), rng.integers(0, 2, 800)),
        ("ternary-coupled-0.75", *coupled_pair(rng, 750, 3, 0.75)),
        ("quaternary-coupled-0.6", *coupled_pair(rng, 600, 4, 0.6)),
    ]
    cases = []
    for label, x, y in pairs:
        xs = [int(v) for v in x]
        ys = [int(v) for v in y]
        cases.append(
            {
                "label": label,
                "x": xs,
                "y": ys,
                "entropyX": float(block_entropy(xs, 1)),
                "entropyY": float(block_entropy(ys, 1)),
                "mutualInformation": float(mutual_info(xs, ys)),
                "te": [
                    {
                        "k": k,
                        "xy": float(transfer_entropy(xs, ys, k)),
                        "yx": float(transfer_entropy(ys, xs, k)),
                    }
                    for k in (1, 2, 3)
                ],
            }
        )
    write("te.json", {"cases": cases})


if __name__ == "__main__":
    te_fixture()
