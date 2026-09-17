# /// script
# requires-python = ">=3.11"
# dependencies = ["scipy>=1.11", "numpy>=1.26", "mpmath>=1.3"]
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


def _side_mass(mp, alpha, beta, p0, side):
    """Beta(alpha, beta) mass above ("greater") or below ("less") p0, by mpmath quad.

    The density is integrated in log form with breakpoints around the mode so the
    tanh-sinh rule resolves the sharp peak of a posterior with n ~ 1e6.
    """
    lnb = mp.loggamma(alpha) + mp.loggamma(beta) - mp.loggamma(alpha + beta)

    def pdf(p):
        return mp.exp((alpha - 1) * mp.log(p) + (beta - 1) * mp.log1p(-p) - lnb)

    lo, hi = (mp.mpf(p0), mp.mpf(1)) if side == "greater" else (mp.mpf(0), mp.mpf(p0))
    s = mp.sqrt(alpha * beta / ((alpha + beta) ** 2 * (alpha + beta + 1)))
    mean = alpha / (alpha + beta)
    points = sorted({lo, hi, *[mean + j * s for j in (-60, -12, -4, 0, 4, 12, 60) if lo < mean + j * s < hi]})
    return mp.quad(pdf, points)


def bayes_p0_fixture() -> None:
    # General-null and one-sided binomial Bayes factors (psi 0.2.0):
    #   ln BF10 = lnB(k+a, n-k+b) - lnB(a, b) - k ln p0 - (n-k) ln(1-p0)            (mpmath loggamma)
    #   ln BF+0 = ln BF10 + ln P(p > p0 | posterior) - ln P(p > p0 | prior)          (mpmath quad)
    #   ln BF-0 = ln BF10 + ln P(p < p0 | posterior) - ln P(p < p0 | prior)
    # Side masses are cross-checked against scipy.special.betainc (double precision).
    import mpmath as mp
    from scipy.special import betainc, betaincc

    mp.mp.dps = 40
    cases = []
    for k, n, p0 in [
        (0, 1, 0.5),
        (3, 10, 0.5),
        (7, 10, 0.5),
        (80, 100, 0.5),
        (122, 354, 0.25),  # autoganzfeld direct hits
        (5, 25, 0.2),  # one Zener run at chance expectation
        (9, 25, 0.2),
        (4, 24, 1 / 6),  # one Rhine dice run
        (268, 600, 0.5),  # Rhine & Pratt placement example
        (5100, 10000, 0.5),
        (50150, 100000, 0.5),
        (500000, 1000000, 0.5),
        (501000, 1000000, 0.5),
        (497000, 1000000, 0.5),
        (250600, 1000000, 0.25),
        (166000, 1000000, 1 / 6),
        (0, 1000000, 0.5),
    ]:
        for a, b in [(1.0, 1.0), (0.5, 0.5), (2.0, 2.0), (3.0, 1.0)]:
            ka, kb = mp.mpf(k) + a, mp.mpf(n - k) + b
            lnb = lambda x, y: mp.loggamma(x) + mp.loggamma(y) - mp.loggamma(x + y)
            ln_bf = lnb(ka, kb) - lnb(mp.mpf(a), mp.mpf(b)) - k * mp.log(p0) - (n - k) * mp.log1p(-mp.mpf(p0))
            entry = {"k": k, "n": n, "a": a, "b": b, "p0": p0, "lnBf10": float(ln_bf)}
            for side, key in (("greater", "lnBfPlus"), ("less", "lnBfMinus")):
                post = _side_mass(mp, ka, kb, p0, side)
                prior = _side_mass(mp, mp.mpf(a), mp.mpf(b), p0, side)
                if post < mp.mpf("1e-280"):
                    continue  # underflows double precision in the implementation: not a fixture case
                ref = betaincc(k + a, n - k + b, p0) if side == "greater" else betainc(k + a, n - k + b, p0)
                if post > 1e-200:
                    rel = abs(float(post) / ref - 1)
                    assert rel < 1e-8, (k, n, a, b, p0, side, float(post), ref)
                entry[key] = float(ln_bf + mp.log(post) - mp.log(prior))
            cases.append(entry)
    generator = f"{GENERATOR}, mpmath {mp.__version__}"
    payload = {"generator": generator, "cases": cases}
    path = OUT_DIR / "bayes-p0.json"
    path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {path}")


def basket_fixture() -> None:
    # Synthetic GCP 1.0 basket-data CSV files built from the documented layout
    # (global-mind.org/basket_CSV_v2.html: record types 10/11/12/13, void = missing,
    # one type-13 row per second), plus the expected parse computed here with the
    # csv module: per egg, the kept (sum, unix-ms) pairs with and without the GCP
    # 55..145 exclusion, and the rows where every egg has a kept value.
    import csv
    import datetime
    import io
    import random

    rng = random.Random(19980916)
    eggs = [1, 28, 37, 1000, 1003]
    start, seconds = 905954400, 20
    values = []
    for r in range(seconds):
        row = []
        for e in range(len(eggs)):
            x = sum(rng.getrandbits(1) for _ in range(200))
            if rng.random() < 0.12:
                x = None  # missing sample: a void field
            row.append(x)
        values.append(row)
    values[4][1] = 0  # a real (if improbable) zero: must not be read as missing
    values[7][3] = 150  # outside the GCP exclusion range
    values[11][0] = 54
    values[15] = [None] * len(eggs)  # a second with no data at all still has its row

    def civil(t):
        return datetime.datetime.fromtimestamp(t, datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    def render(expand):
        out = io.StringIO()
        out.write('10,1,10,"Samples per record"\n10,2,10,"Seconds per record"\n')
        out.write('10,3,6,"Records per packet"\n10,4,200,"Trial size"\n')
        out.write(f'11,1,{len(eggs)},"Eggs reporting"\n')
        end = start + seconds - 1
        out.write(f'11,2,{start},"Start time",{civil(start) if expand else ""}\n')
        out.write(f'11,3,{end},"End time",{civil(end) if expand else ""}\n')
        out.write(f'11,4,{seconds},"Seconds of data"\n')
        label = '"Date/Time"' if expand else ""
        out.write(f'12,"gmtime",{label},{",".join(map(str, eggs))}\n')
        for r, row in enumerate(values):
            t = start + r
            cells = ["" if x is None else str(x) for x in row]
            out.write(f"13,{t},{civil(t) if expand else ''},{','.join(cells)}\n")
        return out.getvalue()

    def expected(text, lo, hi):
        rows = list(csv.reader(io.StringIO(text)))
        ids = [int(x) for x in next(r for r in rows if r[0] == "12")[3:]]
        per = {i: {"sums": [], "timestamps": [], "missing": 0, "filtered": 0} for i in ids}
        complete = {i: {"sums": [], "timestamps": []} for i in ids}
        for row in (r for r in rows if r[0] == "13"):
            t = int(row[1]) * 1000
            kept = {}
            for egg_id, cell in zip(ids, row[3:]):
                if cell == "":
                    per[egg_id]["missing"] += 1
                    continue
                x = int(cell)
                if lo is not None and not lo <= x <= hi:
                    per[egg_id]["filtered"] += 1
                    continue
                per[egg_id]["sums"].append(x)
                per[egg_id]["timestamps"].append(t)
                kept[egg_id] = x
            if len(kept) == len(ids):
                for egg_id in ids:
                    complete[egg_id]["sums"].append(kept[egg_id])
                    complete[egg_id]["timestamps"].append(t)
        return {"eggs": ids, "none": per, "complete": complete}

    basket_dir = OUT_DIR / "basket"
    basket_dir.mkdir(parents=True, exist_ok=True)
    civil_text, brief_text = render(True), render(False)
    (basket_dir / "synthetic-civil.csv").write_text(civil_text)
    (basket_dir / "synthetic-brief.csv").write_text(brief_text)
    payload = {
        "generator": f"python {platform.python_version()} (csv, random.Random(19980916))",
        "start": start,
        "seconds": seconds,
        "gcpFilter": expected(brief_text, 55, 145),
        "unfiltered": expected(brief_text, None, None),
    }
    (basket_dir / "synthetic-expected.json").write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {basket_dir}")


if __name__ == "__main__":
    bayes_fixture()
    bayes_p0_fixture()
    basket_fixture()
