# /// script
# requires-python = ">=3.11"
# ///
"""Generate the expected-consumption fixture for @mindpeeker/oracle.

Run manually (never at test time), stdlib only:

    python3 packages/oracle/scripts/fixtures/expected_bytes.py

Independent of the TypeScript implementation: exact rational arithmetic with
`fractions.Fraction`, the per-attempt rejection probability taken from the
rejected tail r = (256^k mod m) / 256^k, and the expected attempt count from
the geometric series sum_t r^t = 1 / (1 - r).
"""

import json
import platform
from fractions import Fraction
from pathlib import Path

OUT = Path(__file__).resolve().parents[2] / "test" / "fixtures" / "expected-bytes.json"


def uniform_bytes(m: int) -> Fraction:
    if m <= 1:
        return Fraction(0)
    k = 1
    while 256**k < m:
        k += 1
    rejected = Fraction(256**k % m, 256**k)
    return Fraction(k) / (1 - rejected)


def deal_bytes(n: int, count: int, reversals: bool) -> Fraction:
    total = sum((uniform_bytes(n - i) for i in range(count)), Fraction(0))
    if reversals:
        total += (count + 7) // 8
    return total


CASES = [
    ("single", 78, 1, False),
    ("threeCard", 78, 3, False),
    ("threeCard+reversals", 78, 3, True),
    ("celticCross", 78, 10, False),
    ("celticCross+reversals", 78, 10, True),
    ("fullDeck+reversals", 78, 78, True),
    ("runes-24-of-24", 24, 24, False),
    ("uniform-257", 257, 1, False),
    ("uniform-65537", 65537, 1, False),
    ("uniform-10", 10, 1, False),
    ("deal-3-of-2^32", 2**32, 3, False),
    ("deal-5-of-100000", 100000, 5, True),
    ("empty", 78, 0, True),
]


def main() -> None:
    cases = []
    for name, n, count, reversals in CASES:
        value = deal_bytes(n, count, reversals)
        cases.append(
            {
                "name": name,
                "n": n,
                "count": count,
                "reversals": reversals,
                "numerator": str(value.numerator),
                "denominator": str(value.denominator),
                "value": float(value),
            }
        )
    payload = {"generator": f"python {platform.python_version()} fractions", "cases": cases}
    OUT.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
