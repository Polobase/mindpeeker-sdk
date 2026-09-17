"""Reference values for @mindpeeker/judging: ranks, rank matrices, multiplicity,
optional stopping and displacement nulls. Imported by generate.py (same
provenance rules: integer/Fraction arithmetic, itertools enumeration, mpmath
quadrature, SciPy only for the Friedman statistic)."""

import itertools
import math
from fractions import Fraction

import mpmath as mp
import numpy as np
from scipy import stats


def f(x) -> float:
    return float(x)


def binom_pmf_exact(k: int, n: int, p: Fraction) -> Fraction:
    return math.comb(n, k) * p**k * (1 - p) ** (n - k)


# ---------------------------------------------------------------------------
# ranks


def sum_of_ranks_counts(n, k):
    dist = [1]
    for _ in range(n):
        nxt = [0] * (len(dist) + k - 1)
        for i, c in enumerate(dist):
            for d in range(k):
                nxt[i + d] += c
        dist = nxt
    return dist  # index = sum - n; total k**n


def ranks_fixtures():
    small = sum_of_ranks_counts(8, 4)
    tails = []
    for n, k, s in [(30, 6, 80), (100, 4, 180), (100, 4, 120), (500, 5, 1350), (12, 10, 40)]:
        counts = sum_of_ranks_counts(n, k)
        tails.append(
            {
                "trials": n,
                "choices": k,
                "sum": s,
                "lower": f(Fraction(sum(counts[: s - n + 1]), k**n)),
                "upper": f(Fraction(sum(counts[s - n :]), k**n)),
            }
        )
    return {
        "pmf8x4": [f(Fraction(c, 4**8)) for c in small],
        "tails": tails,
    }


def friedman_fixture():
    judges = [
        [1, 2, 3, 4, 5],
        [2, 1, 3.5, 3.5, 5],
        [1, 3, 2, 5, 4],
        [2.5, 2.5, 1, 4, 5],
    ]
    res = stats.friedmanchisquare(*np.array(judges).T)
    return {"judgeRanks": judges, "chi2": float(res.statistic), "p": float(res.pvalue)}


# ---------------------------------------------------------------------------
# rank matrices


def perm_count(matrix, better):
    k = len(matrix)
    obs = sum(matrix[i][i] for i in range(k))
    count = 0
    for perm in itertools.permutations(range(k)):
        s = sum(matrix[i][perm[i]] for i in range(k))
        if (better == "lower" and s <= obs + 1e-9) or (better == "higher" and s >= obs - 1e-9):
            count += 1
    return count, math.factorial(k)


def rank_matrix_fixtures():
    rng = np.random.default_rng(20260917)
    cases = []
    sri = [
        [1, 3, 2, 5, 6, 4],
        [2, 1, 4, 3, 5, 6],
        [4, 2, 1, 6, 3, 5],
        [6, 5, 3, 2, 1, 4],
        [3, 6, 5, 1, 2, 3],
        [5, 4, 6, 4, 4, 1],
    ]
    cases.append({"matrix": sri, "better": "lower"})
    ratings = rng.integers(1, 8, size=(7, 7)).tolist()
    for i in range(7):
        ratings[i][i] = min(7, ratings[i][i] + 2)
    cases.append({"matrix": ratings, "better": "higher"})
    reals = np.round(rng.random((8, 8)) * 10, 3).tolist()
    for i in range(8):
        reals[i][i] = round(reals[i][i] * 0.6, 3)
    cases.append({"matrix": reals, "better": "lower"})
    out = []
    for c in cases:
        count, total = perm_count(c["matrix"], c["better"])
        out.append({**c, "count": count, "total": total})
    return out


# ---------------------------------------------------------------------------
# multiplicity


def expected_max(I):
    I = mp.mpf(I)
    pdf = lambda x: mp.npdf(x)
    cdf = lambda x: mp.ncdf(x)
    center = mp.sqrt(2 * mp.log(I)) if I > 1 else 0
    return mp.quad(lambda x: x * I * pdf(x) * cdf(x) ** (I - 1), [-mp.inf, -5, 0, center, center + 3, mp.inf])


def approx_max(I):
    g = mp.euler
    q = lambda p: mp.sqrt(2) * mp.erfinv(2 * p - 1)
    return (1 - g) * q(1 - mp.mpf(1) / I) + g * q(1 - 1 / (I * mp.e))


def multiplicity_fixtures():
    looks = [2, 3, 4, 5, 10, 50, 100, 1000, 10000, 1000000]
    emax = [
        {"looks": I, "exact": f(expected_max(I)), "approximation": f(approx_max(I))}
        for I in looks
    ]
    critical = []
    for I, alpha, sided in [(10, 0.05, "one"), (10, 0.05, "two"), (1000, 0.01, "one"), (10**9, 0.05, "two")]:
        a = mp.mpf(alpha)
        per = 1 - (1 - a) ** (mp.mpf(1) / I)
        div = 2 if sided == "two" else 1
        z = -mp.sqrt(2) * mp.erfinv(2 * (per / div) - 1)
        bz = -mp.sqrt(2) * mp.erfinv(2 * (a / I / div) - 1)
        critical.append(
            {"looks": I, "alpha": alpha, "sided": sided, "perLookAlpha": f(per), "z": f(z), "bonferroniZ": f(bz)}
        )
    return emax, critical


def optional_stopping(looks, p0, alpha):
    p0 = Fraction(p0)
    alpha = Fraction(alpha)
    crit = []
    for n in looks:
        c = None
        tail = Fraction(0)
        for h in range(n, -1, -1):
            tail += binom_pmf_exact(h, n, p0)
            if tail <= alpha:
                c = h
            else:
                break
        crit.append(c)
    dist = {0: Fraction(1)}
    trials = 0
    risk = Fraction(0)
    for n, c in zip(looks, crit):
        while trials < n:
            nxt = {}
            for h, pr in dist.items():
                nxt[h] = nxt.get(h, 0) + pr * (1 - p0)
                nxt[h + 1] = nxt.get(h + 1, 0) + pr * p0
            dist = nxt
            trials += 1
        if c is not None:
            for h in list(dist):
                if h >= c:
                    risk += dist.pop(h)
    return {"looks": looks, "p0": f(p0), "alpha": f(alpha), "criticalHits": crit, "risk": f(risk)}


# ---------------------------------------------------------------------------
# displacement: enumerate every target sequence


def displacement_null(calls, m, offsets, run_length):
    n = len(calls)
    dist = {}
    total = m**n
    for targets in itertools.product(range(m), repeat=n):
        hits = 0
        for d in offsets:
            for i in range(n):
                j = i + d
                if 0 <= j < n and i // run_length == j // run_length and calls[i] == targets[j]:
                    hits += 1
        dist[hits] = dist.get(hits, 0) + 1
    mean = Fraction(sum(h * c for h, c in dist.items()), total)
    second = Fraction(sum(h * h * c for h, c in dist.items()), total)
    top = max(dist)
    return {
        "calls": calls,
        "choices": m,
        "offsets": offsets,
        "runLength": run_length,
        "mean": f(mean),
        "variance": f(second - mean * mean),
        "upperTails": [[h, f(Fraction(sum(c for x, c in dist.items() if x >= h), total))] for h in range(top + 1)],
    }
