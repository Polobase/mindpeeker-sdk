# /// script
# requires-python = ">=3.10"
# dependencies = ["mpmath>=1.3"]
# ///
"""Reference values for @mindpeeker/coincidence (numerics, birthday, near, multi, non-uniform, Fisher).

Run manually (never at test time):

    uv run packages/coincidence/scripts/fixtures/generate.py

Writes JSON into packages/coincidence/test/fixtures/. Every number comes from a
computation that shares no code path with the TypeScript:

- exact rational arithmetic (fractions.Fraction) where the inputs are small;
- mpmath at 60 significant digits (loggamma differences, not the TS's
  log1p/Stirling split) where they are large;
- brute-force enumeration to confirm the closed forms used below (the
  Abramson–Moser near-match count, the product rule for independent
  attributes) before those closed forms produce any fixture value.

Floats are written with repr() (17 significant digits).
"""

import itertools
import json
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


def ln_no_match(n: int, c: int):
    """ln prod_{i<n} (1 - i/c) = lnGamma(c+1) - lnGamma(c-n+1) - n ln c (n <= c)."""
    if n > c:
        return mp.ninf
    return mp.loggamma(c + 1) - mp.loggamma(c - n + 1) - n * mp.log(c)


def exact_no_match(n: int, c: int) -> Fraction:
    p = Fraction(1)
    for i in range(n):
        p *= Fraction(c - i, c)
    return p


def pack(ln_p) -> dict:
    """ln P(no match), P(no match) and P(match) = -expm1(ln P) as floats."""
    if ln_p == mp.ninf:
        return {"lnNoMatch": None, "noMatch": 0.0, "match": 1.0}
    return {
        "lnNoMatch": float(ln_p),
        "noMatch": float(mp.exp(ln_p)),
        "match": float(-mp.expm1(ln_p)),
    }


def smallest_n(prob_match, target, lo: int, hi: int) -> int:
    """Smallest n in [lo, hi] with prob_match(n) >= target (monotone, prob_match(hi) >= target)."""
    while lo < hi:
        mid = (lo + hi) // 2
        if prob_match(mid) >= target:
            hi = mid
        else:
            lo = mid + 1
    return lo


# ---------------------------------------------------------------- birthday

def birthday() -> None:
    small = [(0, 365), (1, 365), (2, 365), (10, 365), (22, 365), (23, 365), (26, 365),
             (32, 365), (35, 365), (50, 365), (57, 365), (100, 365), (365, 365), (366, 365),
             (20, 100), (11, 100), (12, 100), (13, 100), (22, 366), (23, 366), (3, 2), (2, 2)]
    cases = []
    for n, c in small:
        exact = exact_no_match(n, c)
        ln_p = mp.log(mp.mpf(exact.numerator) / exact.denominator) if exact > 0 else mp.ninf
        cases.append({"n": n, "c": c, **pack(ln_p)})
    large = [(500, 2_400_000), (3016, 13_983_816), (5000, 10**9), (4096, 10**7),
             (2049, 10**6), (1_000_000, 10**12), (3_000_000, 10**15), (2**20 + 5, 2**40),
             (60_000, 100_000), (99_990, 100_000), (100_000, 100_000)]
    for n, c in large:
        cases.append({"n": n, "c": c, **pack(ln_no_match(n, c))})

    people = []
    for p in ["0.5", "0.95", "0.99", "0.001"]:
        for c in [2, 100, 365, 366, 2_400_000, 10**12]:
            target = mp.mpf(p)
            n = smallest_n(lambda m: -mp.expm1(ln_no_match(m, c)), target, 1, c + 1)
            people.append({"p": float(p), "c": c, "n": n})
    write("birthday.json", {"cases": cases, "peopleForMatch": people})


# ---------------------------------------------------------------- near matches

def brute_near(n: int, c: int, d: int, circular: bool) -> Fraction:
    good = 0
    for xs in itertools.product(range(c), repeat=n):
        ok = True
        for i in range(n):
            for j in range(i + 1, n):
                diff = abs(xs[i] - xs[j])
                dist = min(diff, c - diff) if circular else diff
                if dist <= d:
                    ok = False
                    break
            if not ok:
                break
        good += ok
    return Fraction(good, c**n)


def near_formula(n: int, c: int, d: int, circular: bool) -> Fraction:
    """Abramson–Moser (circle) and the line analogue, as exact rationals."""
    if n <= 1:
        return Fraction(1)
    if circular:
        if 2 * d + 1 >= c or n * (d + 1) > c:
            return Fraction(0)
        p = Fraction(1)
        for i in range(1, n):
            p *= Fraction(c - n * d - i, c)
        return p
    a = c - (n - 1) * d
    if a < n:
        return Fraction(0)
    p = Fraction(1)
    for i in range(n):
        p *= Fraction(a - i, c)
    return p


def ln_near(n: int, c: int, d: int, circular: bool):
    if n <= 1:
        return mp.mpf(0)
    if circular:
        if 2 * d + 1 >= c or n * (d + 1) > c:
            return mp.ninf
        a, m = c - n * d - 1, n - 1
    else:
        a, m = c - (n - 1) * d, n
        if a < n:
            return mp.ninf
    return mp.loggamma(a + 1) - mp.loggamma(a - m + 1) - m * mp.log(c)


def near() -> None:
    for c in range(1, 9):
        for n in range(0, 4):
            for d in range(0, 4):
                for circular in (True, False):
                    assert brute_near(n, c, d, circular) == near_formula(n, c, d, circular), (
                        n, c, d, circular)
    cases = []
    for n, c, d in [(2, 5, 1), (2, 6, 2), (14, 365, 1), (13, 365, 1), (7, 365, 7), (6, 365, 7),
                    (23, 365, 0), (100, 365, 2), (40, 365, 4), (73, 365, 4), (74, 365, 4),
                    (10, 30, 2), (1000, 10**7, 3)]:
        for circular in (True, False):
            exact = near_formula(n, c, d, circular)
            if n <= 200:
                ln_p = mp.log(mp.mpf(exact.numerator) / exact.denominator) if exact > 0 else mp.ninf
            else:
                ln_p = ln_near(n, c, d, circular)
            cases.append({"n": n, "c": c, "d": d, "circular": circular, **pack(ln_p)})
    people = []
    for circular in (True, False):
        for d in range(0, 11):
            for p in ["0.5", "0.95"]:
                c = 365
                hi = c // (d + 1) + 2
                n = smallest_n(lambda m: 1 - mp.exp(ln_near(m, c, d, circular))
                               if ln_near(m, c, d, circular) != mp.ninf else mp.mpf(1),
                               mp.mpf(p), 1, hi)
                people.append({"p": float(p), "c": c, "d": d, "circular": circular, "n": n})
    write("near.json", {"cases": cases, "peopleForNearMatch": people})


# ---------------------------------------------------------------- several attributes

def multi() -> None:
    # Product rule confirmed by brute force: two attributes with 3 and 4 values, 3 people.
    cs = [3, 4]
    good = 0
    total = 0
    values = list(itertools.product(range(3), range(4)))
    for people in itertools.product(values, repeat=3):
        total += 1
        ok = all(len({p[a] for p in people}) == 3 for a in range(2))
        good += ok
    assert Fraction(good, total) == exact_no_match(3, 3) * exact_no_match(3, 4)

    def ln_any(n: int, cats):
        return sum((ln_no_match(n, c) for c in cats), mp.mpf(0))

    cases = []
    for cats in ([365, 1000, 500], [365, 365], [12, 31, 7], [64, 78, 256]):
        for n in (2, 5, 10, 15, 16, 20):
            cases.append({"n": n, "cs": cats, **pack(ln_any(n, cats))})
    people = []
    for cats in ([365, 1000, 500], [365, 365], [12, 31, 7], [64, 78, 256]):
        for p in ["0.5", "0.95"]:
            hi = min(cats) + 1
            n = smallest_n(lambda m: -mp.expm1(ln_any(m, cats)), mp.mpf(p), 1, hi)
            inv = sum(Fraction(1, c) for c in cats)
            approx = mp.sqrt(2 / (mp.mpf(inv.numerator) / inv.denominator)
                             * mp.log(1 / (1 - mp.mpf(p))))
            people.append({"p": float(p), "cs": cats, "n": n, "approx": float(approx)})
    write("multi.json", {"cases": cases, "people": people})


# ---------------------------------------------------------------- non-uniform categories

def e_n_times_factorial(n: int, probs) -> Fraction:
    """n! * e_n(p): the exact probability that n draws land in distinct categories."""
    e = [Fraction(1)] + [Fraction(0)] * n
    for p in probs:
        for j in range(n, 0, -1):
            e[j] += p * e[j - 1]
    f = 1
    for i in range(2, n + 1):
        f *= i
    return e[n] * f


def nonuniform() -> None:
    # Confirm n! e_n against brute force on a 4-category vector.
    probs = [Fraction(1, 2), Fraction(1, 4), Fraction(1, 8), Fraction(1, 8)]
    for n in range(0, 5):
        brute = Fraction(0)
        for xs in itertools.product(range(4), repeat=n):
            if len(set(xs)) == n:
                w = Fraction(1)
                for x in xs:
                    w *= probs[x]
                brute += w
        assert brute == e_n_times_factorial(n, probs)
    vectors = {
        "dyadic4": [Fraction(1, 2), Fraction(1, 4), Fraction(1, 8), Fraction(1, 8)],
        "linear10": [Fraction(i, 55) for i in range(1, 11)],
        "zipf20": None,
        "withZeros": [Fraction(0), Fraction(3, 10), Fraction(0), Fraction(7, 10)],
    }
    h = sum(Fraction(1, i) for i in range(1, 21))
    vectors["zipf20"] = [Fraction(1, i) / h for i in range(1, 21)]
    cases = []
    for name, vec in vectors.items():
        for n in (0, 1, 2, 3, 5, 8, 12):
            exact = e_n_times_factorial(n, vec)
            ln_p = mp.log(mp.mpf(exact.numerator) / exact.denominator) if exact > 0 else mp.ninf
            match = 1 - exact
            cases.append({
                "name": name,
                "n": n,
                "probs": [float(p) for p in vec],
                "noMatch": float(mp.mpf(exact.numerator) / exact.denominator),
                "match": float(mp.mpf(match.numerator) / match.denominator),
                "lnNoMatch": None if ln_p == mp.ninf else float(ln_p),
                "collision": float(mp.mpf(sum(p * p for p in vec).numerator)
                                   / sum(p * p for p in vec).denominator),
            })
    write("nonuniform.json", {"cases": cases})


# ---------------------------------------------------------------- Fisher 1924

def fisher() -> None:
    log10 = lambda x: mp.log10(x)  # noqa: E731
    suit_p = [mp.mpf(1) / 2, mp.mpf(1) / 4, mp.mpf(1) / 4]  # O, C, S
    value_p = [mp.mpf(60) / 169, mp.mpf(96) / 169, mp.mpf(13) / 169]  # O, R, N

    def raw_scores(ps):
        out = []
        for g in range(len(ps)):
            out.append(-log10(sum(ps[g:])))
        return out

    suit_raw = raw_scores(suit_p)
    value_raw = raw_scores(value_p)
    mean = mp.mpf(0)
    second = mp.mpf(0)
    for i, ps in enumerate(suit_p):
        for j, pv in enumerate(value_p):
            r = suit_raw[i] + value_raw[j]
            mean += ps * pv * r
            second += ps * pv * r * r
    sd = mp.sqrt(second - mean * mean)
    table = {}
    raw_table = {}
    for i, sl in enumerate("OCS"):
        for j, vl in enumerate("ORN"):
            r = suit_raw[i] + value_raw[j]
            raw_table[sl + vl] = float(r)
            table[sl + vl] = float((r - mean) * 10 / sd)
    write("fisher.json", {
        "mean": float(mean),
        "sd": float(sd),
        "raw": raw_table,
        "standardized": table,
        "suitRaw": [float(x) for x in suit_raw],
        "valueRaw": [float(x) for x in value_raw],
    })


# ---------------------------------------------------------------- numerics

def numerics() -> None:
    poisson = []
    for k, lam in [(1, "1"), (3, "0.0001"), (3, "2"), (5, "5"), (50, "100"), (200, "100"),
                   (1001, "1000"), (1000, "1001"), (1, "700"), (30, "1e-3"), (2, "0.5")]:
        lam_mp = mp.mpf(lam)
        below = mp.gammainc(k, lam_mp, regularized=True)  # Q(k, lam) = P(X <= k-1)
        above = mp.gammainc(k, 0, lam_mp, regularized=True)  # P(k, lam) = P(X >= k)
        poisson.append({"k": k, "lambda": float(lam_mp), "below": float(below),
                        "atLeast": float(above)})
    ln_gamma = [{"x": x, "value": float(mp.loggamma(mp.mpf(x)))}
                for x in ["0.5", "1", "1.5", "7.25", "10", "100.5", "171", "1e6"]]
    falling = []
    for a, m, c in [(10**6, 3000, 10**6), (5000, 4990, 10**4), (10**12, 4000, 10**12),
                    (10**5 - 7, 3000, 10**5), (2048 + 40, 2049, 10**4), (10**9, 2049, 10**9),
                    (365, 300, 365), (2**40, 2**20 + 5, 2**40)]:
        value = mp.loggamma(a + 1) - mp.loggamma(a - m + 1) - m * mp.log(c)
        falling.append({"a": a, "m": m, "c": c, "value": float(value)})
    write("numerics.json", {"poisson": poisson, "lnGamma": ln_gamma, "lnFallingOverPower": falling})


if __name__ == "__main__":
    numerics()
    birthday()
    near()
    multi()
    nonuniform()
    fisher()
