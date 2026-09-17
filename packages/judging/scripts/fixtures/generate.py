# /// script
# requires-python = ">=3.10"
# dependencies = ["mpmath>=1.3", "scipy>=1.11", "numpy>=1.26"]
# ///
"""Reference values for @mindpeeker/judging.

Run manually (never at test time):

    uv run packages/judging/scripts/fixtures/generate.py

Writes packages/judging/test/fixtures/judging.json (with nulls.py, imported
below). Nothing here shares a code
path with the TypeScript:

- exact integer / fractions.Fraction arithmetic for binomial tails, the
  two-sided minimum-likelihood p, closed-deck distributions (a DP over
  contingency tables, not the rook-polynomial inclusion-exclusion the package
  uses), Read's feedback recursion, sum-of-ranks convolutions, displacement
  nulls (brute-force enumeration of every target sequence), optional-stopping
  risk (exact DP) and rank-matrix permutation counts (itertools.permutations);
- mpmath at 50 digits for Bayes factors (log-gamma differences; the one-sided
  posterior masses of the n = 1e6 cases come from SciPy's Boost incomplete
  beta, because mpmath's series does not finish there), channel
  capacities and the expected maximum of I normals (quadrature of the density
  form, not the tail form the package integrates);
- SciPy for Clopper-Pearson bounds and the Friedman statistic, and as a
  cross-check of the exact two-sided binomial p.

Floats are written with repr() (17 significant digits).
"""

import json
import math
import platform
from fractions import Fraction
from pathlib import Path

import mpmath as mp
import numpy as np
import scipy
from scipy import special, stats

from nulls import (  # sibling module in this directory (ranks, matrices, multiplicity, displacement)
    displacement_null,
    friedman_fixture,
    multiplicity_fixtures,
    optional_stopping,
    rank_matrix_fixtures,
    ranks_fixtures,
)

mp.mp.dps = 50
OUT = Path(__file__).resolve().parents[2] / "test" / "fixtures" / "judging.json"


def f(x) -> float:
    return float(x)


# ---------------------------------------------------------------------------
# binomial


def binom_pmf_exact(k: int, n: int, p: Fraction) -> Fraction:
    return math.comb(n, k) * p**k * (1 - p) ** (n - k)


def binom_tails(k: int, n: int, p: Fraction):
    # integer weights w_j = C(n, j) num^j (den - num)^(n - j); probabilities are w_j / den^n
    num, den = p.numerator, p.denominator
    weights = [math.comb(n, j) * num**j * (den - num) ** (n - j) for j in range(n + 1)]
    scale = den**n
    upper = Fraction(sum(weights[k:]), scale)
    lower = Fraction(sum(weights[: k + 1]), scale)
    d = weights[k]
    # minimum-likelihood two-sided p with SciPy's relative tolerance 1 + 1e-7:
    # w_j <= d (1 + 1e-7)  <=>  10^7 w_j <= (10^7 + 1) d
    if k * den == num * n:
        two = Fraction(1)
    else:
        two = min(Fraction(1), Fraction(sum(w for w in weights if 10**7 * w <= (10**7 + 1) * d), scale))
    return upper, lower, two


BINOMIAL_CASES = [
    (122, 354, Fraction(1, 4)),
    (268, 600, Fraction(1, 2)),
    (644, 2704, Fraction(1, 5)),
    (7, 25, Fraction(1, 5)),
    (0, 25, Fraction(1, 5)),
    (25, 25, Fraction(1, 5)),
    (3, 50, Fraction(1, 6)),
    (40, 100, Fraction(1, 4)),
    (1, 10, Fraction(1, 2)),
    (5, 10, Fraction(1, 2)),
    (20, 24, Fraction(1, 6)),
    (1, 30, Fraction(1, 4)),
    (1300, 6000, Fraction(1, 5)),
]


def binomial_fixtures():
    out = []
    for k, n, p in BINOMIAL_CASES:
        upper, lower, two = binom_tails(k, n, p)
        sp = stats.binomtest(k, n, float(p))
        assert math.isclose(sp.pvalue, f(two), rel_tol=1e-9, abs_tol=1e-300), (k, n, p)
        ci = stats.binomtest(k, n, float(p)).proportion_ci(confidence_level=0.95, method="exact")
        out.append(
            {
                "hits": k,
                "trials": n,
                "p0": f(p),
                "pOneSided": f(upper),
                "pLower": f(lower),
                "pTwoSided": f(two),
                "ciLower": float(ci.low),
                "ciUpper": float(ci.high),
            }
        )
    return out


# ---------------------------------------------------------------------------
# Bayes factors


def ln_beta(x, y):
    return mp.loggamma(x) + mp.loggamma(y) - mp.loggamma(x + y)


def side_mass(a, b, p0, upper):
    """Beta(a, b) mass above (upper) or below p0: mpmath for moderate shapes;
    SciPy's Boost incomplete beta (double precision) where mpmath's series
    does not finish (shapes > 1e4 in the n = 1e6 cases, whose masses are O(0.05-1))."""
    if max(a, b) <= 1e4:
        return mp.betainc(a, b, p0, 1, regularized=True) if upper else mp.betainc(a, b, 0, p0, regularized=True)
    fa, fb, fp = float(a), float(b), float(p0)
    v = special.betainc(fb, fa, 1 - fp) if upper else special.betainc(fa, fb, fp)
    assert v > 1e-12
    return mp.mpf(v)


def ln_bf(k, n, p0, a, b, alternative):
    k, n, p0, a, b = mp.mpf(k), mp.mpf(n), mp.mpf(p0), mp.mpf(a), mp.mpf(b)
    base = ln_beta(k + a, n - k + b) - ln_beta(a, b) - k * mp.log(p0) - (n - k) * mp.log(1 - p0)
    if alternative == "two-sided":
        return base
    upper = alternative == "greater"
    post = side_mass(k + a, n - k + b, p0, upper)
    prior = side_mass(a, b, p0, upper)
    return base + mp.log(post) - mp.log(prior)


BAYES_CASES = [
    (122, 354, mp.mpf(1) / 4, 1, 1),
    (7, 25, mp.mpf(1) / 5, 1, 1),
    (0, 10, mp.mpf(1) / 6, 1, 1),
    (500600, 1000000, mp.mpf(1) / 2, 1, 1),
    (250700, 1000000, mp.mpf(1) / 4, 2, 6),
    (100, 1000, mp.mpf("0.1"), mp.mpf("0.5"), mp.mpf("0.5")),
    (30, 100, mp.mpf(1) / 4, 3, 9),
    (5, 5, mp.mpf(1) / 2, 1, 1),
]


def bayes_fixtures():
    out = []
    for k, n, p0, a, b in BAYES_CASES:
        for alt in ("two-sided", "greater", "less"):
            out.append(
                {
                    "hits": k,
                    "trials": n,
                    "p0": f(p0),
                    "a": f(a),
                    "b": f(b),
                    "alternative": alt,
                    "lnBf10": f(ln_bf(k, n, p0, a, b, alt)),
                }
            )
    return out


# ---------------------------------------------------------------------------
# closed decks: DP over contingency tables (rows = call symbols)


def compositions(total, parts, caps):
    if parts == 1:
        if total <= caps[0]:
            yield (total,)
        return
    for x in range(min(total, caps[0]) + 1):
        for rest in compositions(total - x, parts - 1, caps[1:]):
            yield (x,) + rest


def closed_deck_counts(symbols, calls):
    K = len(symbols)
    states = {tuple(symbols): {0: 1}}
    for s, cs in enumerate(calls):
        nxt = {}
        for remaining, poly in states.items():
            for row in compositions(cs, K, remaining):
                weight = math.factorial(cs)
                for x in row:
                    weight //= math.factorial(x)
                new_rem = tuple(r - x for r, x in zip(remaining, row))
                target = nxt.setdefault(new_rem, {})
                for m, c in poly.items():
                    key = m + row[s]
                    target[key] = target.get(key, 0) + c * weight
        states = nxt
    (poly,) = states.values()
    N = sum(symbols)
    counts = [poly.get(k, 0) for k in range(N + 1)]
    arrangements = math.factorial(N)
    for t in symbols:
        arrangements //= math.factorial(t)
    assert sum(counts) == arrangements
    return counts, arrangements


CLOSED_CASES = [
    ([5, 5, 5, 5, 5], None, [10, 12]),
    ([3, 2, 2, 1], [2, 2, 2, 2], [3, 5]),
    ([4, 4, 4], [6, 3, 3], [5, 7]),
    ([6, 6, 6, 6], None, [9, 14]),
    ([2, 0, 3], [1, 2, 2], [2, 3]),
]


def closed_fixtures():
    out = []
    for symbols, calls, tails in CLOSED_CASES:
        c = symbols if calls is None else calls
        counts, arr = closed_deck_counts(symbols, c)
        mean = Fraction(sum(k * x for k, x in enumerate(counts)), arr)
        second = Fraction(sum(k * k * x for k, x in enumerate(counts)), arr)
        out.append(
            {
                "symbolCounts": symbols,
                "callCounts": c,
                "arrangements": str(arr),
                "counts": [str(x) for x in counts],
                "mean": f(mean),
                "variance": f(second - mean * mean),
                "upperTails": [[t, f(Fraction(sum(counts[t:]), arr))] for t in tails],
            }
        )
    # Zener pack summed over three runs, exact
    counts, arr = closed_deck_counts([5] * 5, [5] * 5)
    total = [1]
    for _ in range(3):
        nxt = [0] * (len(total) + len(counts) - 1)
        for i, a in enumerate(total):
            for j, b in enumerate(counts):
                nxt[i + j] += a * b
        total = nxt
    runs = {
        "runs": 3,
        "upperTails": [[h, f(Fraction(sum(total[h:]), arr**3))] for h in (20, 25, 30)],
    }
    composition = Fraction(math.factorial(25), math.factorial(5) ** 5 * 5**25)
    # best of three independent looks at a Zener run: exact and binomial
    pmf = [Fraction(x, arr) for x in counts]
    binom = [binom_pmf_exact(j, 25, Fraction(1, 5)) for j in range(26)]

    def emax(p, k):
        cdf = Fraction(0)
        prev = Fraction(0)
        e = Fraction(0)
        for x, q in enumerate(p):
            cdf += q
            e += x * (cdf**k - prev**k)
            prev = cdf
        return e

    return out, runs, f(composition), f(emax(pmf, 3)), f(emax(binom, 3))


# ---------------------------------------------------------------------------
# Read's optimal feedback


def feedback(deck):
    memo = {}

    def solve(state):
        state = tuple(sorted((x for x in state if x > 0), reverse=True))
        rem = sum(state)
        if rem == 0:
            return [Fraction(1)]
        if state in memo:
            return memo[state]
        out = [Fraction(0)] * (rem + 1)
        guess = 0  # index of a most frequent symbol (state is sorted)
        for j, cj in enumerate(state):
            succ = list(state)
            succ[j] -= 1
            sub = solve(succ)
            w = Fraction(cj, rem)
            for k, s in enumerate(sub):
                out[k + (1 if j == guess else 0)] += w * s
        memo[state] = out
        return out

    pmf = solve(deck)
    mean = sum(k * p for k, p in enumerate(pmf))
    second = sum(k * k * p for k, p in enumerate(pmf))
    return {
        "deck": deck,
        "expected": f(mean),
        "variance": f(second - mean * mean),
        "pmf": [f(p) for p in pmf],
    }


def main():
    closed, closed_runs, composition, emax_closed, emax_binom = closed_fixtures()
    emax, critical = multiplicity_fixtures()
    data = {
        "generator": "packages/judging/scripts/fixtures/generate.py",
        "versions": {
            "python": platform.python_version(),
            "mpmath": mp.__version__,
            "scipy": scipy.__version__,
            "numpy": np.__version__,
        },
        "binomial": binomial_fixtures(),
        "bayes": bayes_fixtures(),
        "closedDeck": closed,
        "closedDeckRuns": closed_runs,
        "zenerCompositionProbability": composition,
        "expectedMaxOfPmf": {"closed": emax_closed, "binomial": emax_binom},
        "feedback": [feedback(d) for d in ([5, 5, 5, 5, 5], [4] * 13, [3, 2, 1], [2, 2], [7])],
        "capacity": [
            {"hitRate": hr, "choices": k, "bits": f(mp.log(k, 2) + (0 if hr == 0 else mp.mpf(hr) * mp.log(hr, 2)) + (0 if hr == 1 else (1 - mp.mpf(hr)) * mp.log((1 - mp.mpf(hr)) / (k - 1), 2)))}
            for hr, k in [(6 / 25, 5), (7 / 25, 5), (0.32, 4), (0.0, 5), (1.0, 5), (0.75, 2)]
        ],
        "ranks": ranks_fixtures(),
        "friedman": friedman_fixture(),
        "rankMatrix": rank_matrix_fixtures(),
        "expectedMax": emax,
        "deflated": critical,
        "optionalStopping": [
            optional_stopping(list(range(10, 201)), Fraction(1, 4), Fraction(1, 20)),
            optional_stopping([20, 40, 60, 80, 100], Fraction(1, 5), Fraction(1, 20)),
            optional_stopping([50], Fraction(1, 2), Fraction(1, 100)),
        ],
        "displacement": [
            displacement_null([0, 0, 1, 2, 2, 2, 1], 3, [-1, 0, 1], 7),
            displacement_null([0, 1, 1, 3, 2, 2, 0, 3], 4, [0, 1, 2], 4),
            displacement_null([1, 1, 1, 1, 0, 2, 1], 3, [-2, 1], 7),
        ],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, indent=2) + "\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
