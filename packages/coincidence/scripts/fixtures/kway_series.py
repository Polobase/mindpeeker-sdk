# /// script
# requires-python = ">=3.10"
# dependencies = ["mpmath>=1.3"]
# ///
"""Reference values for @mindpeeker/coincidence k-fold matches and seriesClustering.

Run manually (never at test time):

    uv run packages/coincidence/scripts/fixtures/kway_series.py

Writes kway.json and series.json into packages/coincidence/test/fixtures/.
The methods share no code path with the TypeScript (which uses a
conditional-binomial dynamic programme and Levin's truncated-Poisson
representation):

- equal categories: the exact integer count U_m of maps [m] -> [c] with every
  fibre < k, from the power-of-a-polynomial recurrence for E(x)^c with
  E(x) = sum_{j<k} x^j/j! (J. C. P. Miller):
      m U_m = sum_{j=1}^{min(m,k-1)} ((c+1) j - m) C(m, j) U_{m-j},  U_0 = 1,
  so P(no k-fold match) = U_n / c^n exactly (big integers, no rounding);
- unequal categories: n! [x^n] prod_i sum_{j<k} (p_i x)^j / j! in exact
  fractions (the exponential generating function of the multinomial);
- brute-force enumeration confirms both before they produce fixture values;
- the Diaconis–Mosteller equation (7.5) is solved by bisection in mpmath;
- the Poisson-rate null uses mpmath's regularized incomplete gamma.
"""

import itertools
import json
import math
import platform
from fractions import Fraction
from pathlib import Path

import mpmath as mp

mp.mp.dps = 60
OUT_DIR = Path(__file__).resolve().parents[2] / "test" / "fixtures"
GENERATOR = f"python {platform.python_version()}, mpmath {mp.__version__} (dps {mp.mp.dps})"


def write(name: str, payload: dict) -> None:
    payload = {"generator": GENERATOR, **payload}
    path = OUT_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {path}")


def counts_no_kfold(n: int, c: int, k: int) -> list:
    """U_0..U_n: number of maps [m] -> [c] with every fibre smaller than k."""
    u = [1]
    for m in range(1, n + 1):
        total = 0
        for j in range(1, min(m, k - 1) + 1):
            total += ((c + 1) * j - m) * math.comb(m, j) * u[m - j]
        assert total % m == 0
        u.append(total // m)
    return u


def brute_no_kfold(n: int, probs, k: int) -> Fraction:
    good = Fraction(0)
    for xs in itertools.product(range(len(probs)), repeat=n):
        counts = [0] * len(probs)
        for x in xs:
            counts[x] += 1
        if max(counts, default=0) < k:
            w = Fraction(1)
            for x in xs:
                w *= probs[x]
            good += w
    return good


def egf_no_kfold(n: int, probs, k: int) -> Fraction:
    poly = [Fraction(1)] + [Fraction(0)] * n
    for p in probs:
        factor = [p**j / math.factorial(j) for j in range(min(k - 1, n) + 1)]
        nxt = [Fraction(0)] * (n + 1)
        for a, ca in enumerate(poly):
            if ca == 0:
                continue
            for j, fj in enumerate(factor):
                if a + j > n:
                    break
                nxt[a + j] += ca * fj
        poly = nxt
    return poly[n] * math.factorial(n)


def as_float(fr: Fraction) -> float:
    return float(mp.mpf(fr.numerator) / fr.denominator)


def pack(no_match: Fraction) -> dict:
    match = 1 - no_match
    return {"noMatch": as_float(no_match), "match": as_float(match)}


def kway() -> None:
    for c in range(1, 5):
        for n in range(0, 6):
            for k in range(1, 5):
                uniform = [Fraction(1, c)] * c
                exact = Fraction(counts_no_kfold(n, c, k)[n], c**n)
                assert exact == brute_no_kfold(n, uniform, k), (n, c, k)
                assert exact == egf_no_kfold(n, uniform, k), (n, c, k)
    skewed = [Fraction(1, 2), Fraction(1, 4), Fraction(1, 8), Fraction(1, 8)]
    for n in range(0, 7):
        for k in range(1, 5):
            assert brute_no_kfold(n, skewed, k) == egf_no_kfold(n, skewed, k)

    uniform_cases = []
    table3 = {2: 23, 3: 88, 4: 187, 5: 313, 6: 460, 7: 623, 8: 798, 9: 985, 10: 1181,
              11: 1385, 12: 1596, 13: 1813}
    for k, big_n in table3.items():
        u = counts_no_kfold(big_n, 365, k)
        for n in (big_n - 1, big_n):
            uniform_cases.append({"n": n, "c": 365, "k": k, **pack(Fraction(u[n], 365**n))})
    extra = [(30, 20, 3), (18, 30, 3), (5, 10, 3), (100, 365, 2), (1000, 64, 20), (64, 64, 5),
             (200, 100_000, 3), (3000, 1_000_000, 3), (2500, 100_000, 3), (400, 10_000, 4),
             (10, 3, 5), (11, 5, 3), (9, 3, 4), (1000, 1000, 2)]
    for n, c, k in extra:
        u = counts_no_kfold(n, c, k)
        uniform_cases.append({"n": n, "c": c, "k": k, **pack(Fraction(u[n], c**n))})

    people = []
    for c, k, p in [(365, 3, "0.5"), (365, 4, "0.5"), (30, 3, "0.5"), (100, 3, "0.95"),
                    (64, 4, "0.5")]:
        target = Fraction(p)
        hi = c * (k - 1) + 1
        u = counts_no_kfold(hi, c, k)
        n = next(m for m in range(hi + 1) if 1 - Fraction(u[m], c**m) >= target)
        people.append({"p": float(p), "c": c, "k": k, "n": n})

    h = sum(Fraction(1, i) for i in range(1, 11))
    zipf10 = [Fraction(1, i) / h for i in range(1, 11)]
    nonuniform_cases = []
    for name, probs, n, k in [("dyadic4", skewed, 6, 3), ("dyadic4", skewed, 3, 2),
                              ("zipf10", zipf10, 15, 3), ("zipf10", zipf10, 25, 5),
                              ("partialBin", [Fraction(2, 7)] * 3 + [Fraction(1, 7)], 9, 4)]:
        nonuniform_cases.append({"name": name, "probs": [float(p) for p in probs], "n": n,
                                 "k": k, **pack(egf_no_kfold(n, probs, k))})

    def dm75(c: int, k: int, p: str):
        rhs = (mp.mpf(c) ** (k - 1) * mp.factorial(k) * mp.log(1 / (1 - mp.mpf(p)))) ** (
            mp.mpf(1) / k)
        f = lambda big_n: (big_n * mp.exp(-big_n / (c * k))  # noqa: E731
                           / (1 - big_n / (c * (k + 1))) ** (mp.mpf(1) / k) - rhs)
        lo, hi = mp.mpf("1e-9"), c * (k + 1) * (1 - mp.mpf("1e-30"))
        assert f(lo) < 0 < f(hi)
        for _ in range(400):  # the left side increases strictly on (0, c(k+1))
            mid = (lo + hi) / 2
            if f(mid) < 0:
                lo = mid
            else:
                hi = mid
        return (lo + hi) / 2

    approx = []
    for c, k, p in [(30, 3, "0.5"), (365, 2, "0.5"), (365, 3, "0.5"), (365, 4, "0.5"),
                    (365, 13, "0.5"), (1_000_000, 3, "0.95")]:
        approx.append({"c": c, "k": k, "p": float(p), "n": float(dm75(c, k, p))})
    write("kway.json", {"uniform": uniform_cases, "people": people,
                        "nonuniform": nonuniform_cases, "dm75": approx})


def poisson_cdf(k: int, mu) -> mp.mpf:
    """P(X <= k) for X ~ Poisson(mu), via the regularized upper incomplete gamma."""
    return mp.gammainc(k + 1, mu, regularized=True)


def pearson_moments(n: int, probs) -> tuple:
    """Exact mean and variance of sum (x_i - n p_i)^2 / (n p_i) by enumerating compositions."""
    b = len(probs)
    mean = Fraction(0)
    second = Fraction(0)
    for xs in itertools.product(range(n + 1), repeat=b):
        if sum(xs) != n:
            continue
        w = Fraction(math.factorial(n))
        for x, p in zip(xs, probs):
            w *= p**x / math.factorial(x)
        stat = sum((x - n * p) ** 2 / (n * p) for x, p in zip(xs, probs))
        mean += w * stat
        second += w * stat * stat
    return mean, second - mean * mean


def series() -> None:
    cases = []
    specs = [
        {"name": "week-of-days", "times": [0.5, 1.25, 1.5, 1.75, 3.2, 6.9], "window": 1,
         "span": [0, 7], "rate": None},
        {"name": "partial-last-window", "times": [0.1, 0.2, 0.3, 2.0, 2.9, 3.4, 3.45],
         "window": 1, "span": [0, 3.5], "rate": None},
        {"name": "month-uniform", "times": [0.5 + i for i in range(20)] + [3.1, 3.2, 3.3],
         "window": 1, "span": [0, 30], "rate": None},
        {"name": "poisson-rate", "times": [0.5, 1.25, 1.5, 1.75, 3.2, 6.9], "window": 1,
         "span": [0, 7], "rate": 0.5},
        {"name": "poisson-rate-partial", "times": [0.1, 0.2, 0.3, 2.0, 2.9, 3.4, 3.45],
         "window": 1, "span": [0, 3.5], "rate": 1.5},
        {"name": "offset-span", "times": [100.2, 100.4, 101.9, 104.0, 104.1, 104.2, 104.3],
         "window": 2, "span": [100, 106], "rate": None},
    ]
    for spec in specs:
        start = Fraction(str(spec["span"][0]))
        end = Fraction(str(spec["span"][1]))
        width = Fraction(str(spec["window"]))
        bins = math.ceil((end - start) / width)
        lengths = [min(width, end - start - i * width) for i in range(bins)]
        counts = [0] * bins
        for t in spec["times"]:
            idx = min(int((Fraction(str(t)) - start) // width), bins - 1)
            counts[idx] += 1
        n = len(spec["times"])
        k = max(counts)
        probs = [length / (end - start) for length in lengths]
        entry = {**spec, "counts": counts, "maxCount": k}
        if spec["rate"] is None:
            no_match = egf_no_kfold(n, probs, k)
            entry["pValue"] = as_float(1 - no_match)
            expected = [n * p for p in probs]
            stat = sum((x - e) ** 2 / e for x, e in zip(counts, expected))
            entry["expected"] = [as_float(e) for e in expected]
            entry["dispersion"] = as_float(stat)
            inv = sum(1 / p for p in probs)
            entry["dispersionMean"] = bins - 1
            entry["dispersionVariance"] = as_float(
                2 * (bins - 1) + (inv - bins * bins - 2 * bins + 2) / n)
        else:
            rate = Fraction(str(spec["rate"]))
            mus = [rate * length for length in lengths]
            prod = mp.mpf(1)
            for mu in mus:
                prod *= poisson_cdf(k - 1, mp.mpf(mu.numerator) / mu.denominator)
            entry["pValue"] = float(1 - prod)
            entry["expected"] = [as_float(mu) for mu in mus]
            entry["dispersion"] = as_float(sum((x - mu) ** 2 / mu for x, mu in zip(counts, mus)))
            entry["dispersionMean"] = bins
            entry["dispersionVariance"] = as_float(sum(2 + 1 / mu for mu in mus))
        cases.append(entry)

    moments = []
    for n, probs in [(5, [Fraction(1, 3)] * 3), (6, [Fraction(2, 7)] * 3 + [Fraction(1, 7)]),
                     (4, [Fraction(1, 2), Fraction(1, 4), Fraction(1, 4)])]:
        mean, var = pearson_moments(n, probs)
        formula = 2 * (len(probs) - 1) + (sum(1 / p for p in probs) - len(probs) ** 2
                                          - 2 * len(probs) + 2) / n
        assert mean == len(probs) - 1 and var == formula, (n, probs, mean, var)
        moments.append({"n": n, "probs": [float(p) for p in probs], "mean": as_float(mean),
                        "variance": as_float(var)})
    write("series.json", {"cases": cases, "pearsonMoments": moments})


if __name__ == "__main__":
    kway()
    series()
