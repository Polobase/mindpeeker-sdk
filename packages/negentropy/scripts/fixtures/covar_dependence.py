# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Exact H0 moments of the experiment-layer event statistics, covar included.

Run manually (never at test time):

    python3 packages/negentropy/scripts/fixtures/covar_dependence.py

Writes test/fixtures/covar-dependence.json. Nothing here uses the closed-form
moment formulas of src/experiment/dependence.ts: for n independent sources of
Binomial(k, 1/2) trials under theoretical calibration, z = (s - k/2) / sqrt(k/4),
every outcome (s_1, ..., s_n) is enumerated with its exact probability, and the
per-step terms

    netvar       X = (sum z)^2 / n
    devvar       Y = sum z^2
    correlation  S = sum_{i<j} z_i z_j
    covar        C = sum_{i<j} (z_i^2 - 1)(z_j^2 - 1)

are rational in s, so their means, variances and covariances are computed as
exact Fractions. The event correlation matrix for a design with varying
present-source counts is then assembled from those enumerated moments
(steps are independent: shared-step covariances over the square root of the
product of whole-window variances).
"""

import itertools
import json
import platform
from fractions import Fraction
from math import comb, sqrt
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
K = 8  # the minimum trial width; kappa = -2/k = -1/4
STATS = ("netvar", "devvar", "correlation", "covar")


def terms(sums, k):
    half = Fraction(k, 2)
    # z_i z_j = (s_i - k/2)(s_j - k/2) * 4/k — rational
    d = [Fraction(s) - half for s in sums]
    scale = Fraction(4, k)
    n = len(sums)
    zz = lambda i, j: d[i] * d[j] * scale  # noqa: E731
    x = sum(zz(i, j) for i in range(n) for j in range(n)) / n
    y = sum(zz(i, i) for i in range(n))
    s = sum(zz(i, j) for i in range(n) for j in range(i + 1, n))
    c = sum((zz(i, i) - 1) * (zz(j, j) - 1) for i in range(n) for j in range(i + 1, n))
    return {"netvar": x, "devvar": y, "correlation": s, "covar": c}


def moments(n, k):
    """Exact covariance matrix of the four per-step terms for n present sources."""
    prob = [Fraction(comb(k, s), 2**k) for s in range(k + 1)]
    mean = {name: Fraction(0) for name in STATS}
    second = {(a, b): Fraction(0) for a in STATS for b in STATS}
    for outcome in itertools.product(range(k + 1), repeat=n):
        p = Fraction(1)
        for s in outcome:
            p *= prob[s]
        t = terms(outcome, k)
        for a in STATS:
            mean[a] += p * t[a]
            for b in STATS:
                second[(a, b)] += p * t[a] * t[b]
    return {(a, b): second[(a, b)] - mean[a] * mean[b] for a in STATS for b in STATS}


def main():
    per_n = {n: moments(n, K) for n in range(1, 5)}
    # design: 60 steps, present counts cycle through 4, 3, 2, 1 in blocks
    counts = [4] * 20 + [3] * 10 + [2] * 10 + [1] * 5 + [4] * 15
    events = [
        {"statistic": "covar", "start": 0, "end": 40},
        {"statistic": "covar", "start": 20, "end": 60},
        {"statistic": "netvar", "start": 0, "end": 60},
        {"statistic": "devvar", "start": 10, "end": 50},
        {"statistic": "correlation", "start": 0, "end": 30},
        {"statistic": "covar", "start": 35, "end": 50},
    ]

    def cov(a, b, n):
        return per_n[n][(a, b)]

    def window_sum(a, b, lo, hi):
        return sum((cov(a, b, counts[t]) for t in range(lo, hi)), Fraction(0))

    totals = [window_sum(e["statistic"], e["statistic"], e["start"], e["end"]) for e in events]
    matrix = []
    for i, a in enumerate(events):
        row = []
        for j, b in enumerate(events):
            lo, hi = max(a["start"], b["start"]), min(a["end"], b["end"])
            shared = window_sum(a["statistic"], b["statistic"], lo, hi)
            scale = totals[i] * totals[j]
            if i == j:
                row.append(1.0)
            else:
                row.append(float(shared) / sqrt(float(scale)) if scale > 0 else 0.0)
        matrix.append(row)

    out = {
        "generator": f"python {platform.python_version()}, fractions (exact enumeration)",
        "bitsPerTrial": K,
        "moments": [
            {
                "n": n,
                "covariance": {
                    f"{a}|{b}": [per_n[n][(a, b)].numerator, per_n[n][(a, b)].denominator]
                    for a in STATS
                    for b in STATS
                },
            }
            for n in range(1, 5)
        ],
        "counts": counts,
        "events": events,
        "correlation": matrix,
    }
    path = ROOT / "test" / "fixtures" / "covar-dependence.json"
    path.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
