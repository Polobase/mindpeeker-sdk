# /// script
# requires-python = ">=3.11"
# dependencies = ["scipy>=1.11", "numpy>=1.26", "statsmodels>=0.14"]
# ///
"""Generate authoritative test fixtures for @mindpeeker/scan.

Run manually (never at test time):

    uv run packages/scan/scripts/fixtures/generate.py

Writes JSON files into packages/scan/test/fixtures/. Every reference value is
computed independently of the TypeScript code:

- deviation.json    exact two-sided binomial p (scipy.stats.binomtest), z, and
                    ln BF10 (scipy.special.betaln) for the p0 = 1/2 null model
- null-bf.json      the exact null distribution of BF10 at N = 256 (median,
                    P(BF10 < 1), E[BF10]) by enumerating Binomial(256, 1/2)
- multiplicity.json Bonferroni / Holm / Benjamini-Hochberg adjusted p-values
                    (statsmodels.stats.multitest) and the chi-square omnibus
- vitality.json     P(GV > t) of General Vitality in exact rational arithmetic
- signature.json    signatureToRate digits (hashlib + unicodedata)
- sweep.json        the first-passage sweep null pmf in exact rationals
"""

import hashlib
import json
import math
import platform
import unicodedata
from fractions import Fraction
from pathlib import Path

import numpy as np
import scipy
import statsmodels
from scipy.special import betaln
from scipy.stats import binom, binomtest, chi2
from statsmodels.stats.multitest import multipletests

OUT_DIR = Path(__file__).resolve().parents[2] / "test" / "fixtures"
GENERATOR = (
    f"python {platform.python_version()}, scipy {scipy.__version__}, "
    f"numpy {np.__version__}, statsmodels {statsmodels.__version__}"
)

P0 = 0.5


def write(name: str, payload: dict) -> None:
    payload = {"generator": GENERATOR, **payload}
    path = OUT_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {path}")


def ln_bf10(k: int, n: int, a: float, b: float) -> float:
    return float(betaln(k + a, n - k + b) - betaln(a, b) + n * math.log(2.0))


def deviation_fixture() -> None:
    cases = []
    for k, n in [
        (0, 1),
        (1, 1),
        (6, 8),
        (8, 8),
        (12, 16),
        (4, 16),
        (8, 16),
        (21, 32),
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
        (1100, 1100),
        (0, 2000),
    ]:
        z = (k - n * P0) / math.sqrt(n * P0 * (1.0 - P0))
        p = float(binomtest(k, n, P0, alternative="two-sided").pvalue)
        for a, b in [(1.0, 1.0), (8.0, 8.0)]:
            ln_bf = ln_bf10(k, n, a, b)
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


def null_bf_fixture() -> None:
    n = 256
    pairs = sorted((ln_bf10(k, n, 1.0, 1.0), float(binom.pmf(k, n, 0.5))) for k in range(n + 1))
    cumulative = 0.0
    median = None
    for ln_bf, p in pairs:
        cumulative += p
        if cumulative >= 0.5:
            median = math.exp(ln_bf)
            break
    below = sum(p for ln_bf, p in pairs if ln_bf < 0)
    mean = sum(math.exp(ln_bf) * p for ln_bf, p in pairs)
    write("null-bf.json", {"n": n, "median": median, "pBelowOne": below, "mean": mean})


def multiplicity_fixture() -> None:
    n = 64
    counts = [32, 40, 45, 20, 33, 12, 50, 31, 36, 28]
    alpha = 0.05
    ps = [float(binomtest(k, n, 0.5).pvalue) for k in counts]
    zs = [(k - n / 2) / math.sqrt(n / 4) for k in counts]
    bonf = multipletests(ps, alpha=alpha, method="bonferroni")[1]
    holm = multipletests(ps, alpha=alpha, method="holm")[1]
    bh = multipletests(ps, alpha=alpha, method="fdr_bh")[1]
    stat = sum(z * z for z in zs)
    write(
        "multiplicity.json",
        {
            "n": n,
            "alpha": alpha,
            "counts": counts,
            "p": ps,
            "pBonferroni": [float(x) for x in bonf],
            "pHolm": [float(x) for x in holm],
            "qBH": [float(x) for x in bh],
            "omnibusStatistic": stat,
            "omnibusP": float(chi2.sf(stat, len(counts))),
        },
    )


def gv_sf(t: int) -> Fraction:
    if t < 0:
        return Fraction(1)
    u_max = max(0, t - 951)
    tail: list[Fraction] = []

    def tail_at(v: int) -> Fraction:
        return Fraction(1) if v < 0 else tail[v]

    for u in range(u_max + 1):
        tail.append(sum((tail_at(u - x) for x in range(50, 101)), Fraction(0)) / 101)
    total = Fraction(0)
    for m in range(1001):
        pm = Fraction((m + 1) ** 3 - m**3, 1001**3)
        if m <= 950:
            if m > t:
                total += pm
        else:
            total += pm * tail_at(t - m)
    return total


def vitality_fixture() -> None:
    thresholds = [-5, 0, 500, 949, 950, 951, 999, 1000, 1001, 1049, 1050, 1100, 1400, 2000, 3000]
    write(
        "vitality.json",
        {"cases": [{"t": t, "sf": float(gv_sf(t))} for t in thresholds]},
    )


def signature_rate(signature: str, length: int, base: int) -> list[int]:
    text = unicodedata.normalize("NFC", signature)
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    width = (base - 1).bit_length()
    stream = bytearray(digest)
    counter = 0
    bit = 0
    digits: list[int] = []

    def next_bit() -> int:
        nonlocal bit, counter
        if bit == len(stream) * 8:
            counter += 1
            stream.extend(hashlib.sha256(digest + counter.to_bytes(4, "big")).digest())
        value = (stream[bit // 8] >> (7 - bit % 8)) & 1
        bit += 1
        return value

    while len(digits) < length:
        v = 0
        for _ in range(width):
            v = v * 2 + next_bit()
        if v < base:
            digits.append(v)
    return digits


def signature_fixture() -> None:
    cases = []
    for signature, length, base in [
        ("John Doe", 6, 44),
        ("Jane Doe", 6, 44),
        ("", 6, 44),
        ("subject-witness", 7, 10),
        ("subject-witness", 7, 336),
        ("caf" + chr(0xE9), 6, 44),  # precomposed e-acute (NFC)
        ("cafe" + chr(0x301), 6, 44),  # e + combining acute (NFD)
        ("Arnica montana", 64, 44),
        ("Arnica montana", 100, 336),
        ("x", 16, 2),
        ("x", 5, 1000),
        ("x", 3, 2**32),
    ]:
        cases.append(
            {
                "signature": signature,
                "length": length,
                "base": base,
                "digits": signature_rate(signature, length, base),
            }
        )
    write("signature.json", {"cases": cases})


def sweep_fixture() -> None:
    cases = []
    for positions in [1, 2, 3, 10, 44]:
        pmf = []
        survive = Fraction(1)
        for k in range(positions):
            hazard = Fraction(k + 1, positions)
            pmf.append(survive * hazard)
            survive *= 1 - hazard
        assert sum(pmf) == 1
        cases.append({"positions": positions, "pmf": [float(x) for x in pmf]})
    write("sweep.json", {"cases": cases})


if __name__ == "__main__":
    deviation_fixture()
    null_bf_fixture()
    multiplicity_fixture()
    vitality_fixture()
    signature_fixture()
    sweep_fixture()
