# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy>=1.26"]
# ///
"""Generate authoritative cross-check fixtures for @mindpeeker/field.

Run manually (never at test time):

    uv run packages/field/scripts/fixtures/generate.py

Writes JSON into packages/field/test/fixtures/. Every fixture embeds its own
points — bun tests never reproduce a Python PRNG. The reference values are
plain numpy implementations of the same estimator formulas the TS uses
(Clark–Evans nearest-neighbour, Besag's centered L(r) − r), so the fixtures
cross-check the TS across a language boundary.
"""

import json
import platform
from pathlib import Path

import numpy as np

OUT_DIR = Path(__file__).resolve().parents[2] / "test" / "fixtures"
GENERATOR = f"python {platform.python_version()}, numpy {np.__version__}"


def write(name: str, payload: dict) -> None:
    payload = {"generator": GENERATOR, **payload}
    path = OUT_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {path}")


def clark_evans(pts, area):
    n = len(pts)
    d = np.sqrt(((pts[:, None, :] - pts[None, :, :]) ** 2).sum(-1))
    np.fill_diagonal(d, np.inf)
    nearest = d.min(1)
    mean_nearest = float(nearest.mean())
    lam = n / area
    expected = 1 / (2 * np.sqrt(lam))
    sd = 0.26136 / np.sqrt(n * lam)
    z = (mean_nearest - expected) / sd
    return {
        "meanNearest": mean_nearest,
        "expectedNearest": float(expected),
        "R": float(mean_nearest / expected),
        "z": float(z),
    }


def ripley_l(pts, area, radii):
    n = len(pts)
    d = np.sqrt(((pts[:, None, :] - pts[None, :, :]) ** 2).sum(-1))
    np.fill_diagonal(d, np.inf)  # exclude self
    out = []
    for r in radii:
        counted = int((d <= r).sum())  # ordered pairs i != j
        k = area / (n * n) * counted
        out.append(float(np.sqrt(k / np.pi) - r))
    return out


def field_fixture() -> None:
    rng = np.random.default_rng(20260727)
    W, H = 100.0, 80.0
    area = W * H

    # CSR points and a clustered pattern (three tight Gaussian blobs)
    csr = np.column_stack([rng.uniform(0, W, 200), rng.uniform(0, H, 200)])
    blobs = []
    for cx, cy in [(20, 20), (60, 50), (80, 25)]:
        blobs.append(rng.normal([cx, cy], 3.0, size=(70, 2)))
    clustered = np.clip(np.vstack(blobs), [0, 0], [W, H])

    radii = [2.0, 4.0, 6.0, 8.0, 10.0, 14.0]
    cases = []
    for label, pts in [("csr200", csr), ("clustered210", clustered)]:
        cases.append(
            {
                "label": label,
                "region": {"kind": "rect", "width": W, "height": H},
                "points": [{"x": float(x), "y": float(y)} for x, y in pts],
                "clarkEvans": clark_evans(pts, area),
                "radii": radii,
                "ripleyL": ripley_l(pts, area, radii),
            }
        )
    write("field.json", {"cases": cases})


if __name__ == "__main__":
    field_fixture()
