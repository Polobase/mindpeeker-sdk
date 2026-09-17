# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Term-by-term check of src/internal/moon-tables.ts against two independent
machine-readable transcriptions of Meeus Tables 47.A and 47.B:

- ERFA `src/moon98.c` (liberfa/erfa, BSD-3-Clause)
- Sonia Keys' `meeus/v3/moonposition/moonposition.go` (MIT)

Usage (network, or pass local copies of the two files):

    uv run packages/ephemeris/scripts/fixtures/check_moon_tables.py [moon98.c moonposition.go]

Exits non-zero and lists every row where our table differs from either copy.
"""

import re
import sys
import urllib.request
from pathlib import Path

ERFA_URL = "https://raw.githubusercontent.com/liberfa/erfa/master/src/moon98.c"
GO_URL = "https://raw.githubusercontent.com/soniakeys/meeus/master/v3/moonposition/moonposition.go"
TABLES = Path(__file__).resolve().parents[2] / "src" / "internal" / "moon-tables.ts"


def read(source: str) -> str:
    if source.startswith("https://"):
        with urllib.request.urlopen(source, timeout=30) as response:
            return response.read().decode()
    return Path(source).read_text()


def ours() -> tuple[list[tuple[int, ...]], list[tuple[int, ...]]]:
    text = TABLES.read_text()
    a = text[text.index("LONGITUDE_DISTANCE_TERMS") : text.index("LATITUDE_TERMS")]
    b = text[text.index("LATITUDE_TERMS") :]
    row6 = r"\[\s*(-?\d+(?:\s*,\s*-?\d+){5})\s*\]"
    row5 = r"\[\s*(-?\d+(?:\s*,\s*-?\d+){4})\s*\]"
    parse = lambda m: tuple(int(x) for x in m.group(1).split(","))
    return [parse(m) for m in re.finditer(row6, a)], [parse(m) for m in re.finditer(row5, b)]


def erfa(text: str) -> tuple[list[tuple[int, ...]], list[tuple[int, ...]]]:
    tlr = text[text.index("static struct termlr tlr[]") : text.index("NLR")]
    tb = text[text.index("static struct termb tb[]") : text.index("NB =")]
    num = r"(-?[\d.]+)"
    a = [
        (int(d), int(m), int(mp), int(f), round(float(cl) * 1e6), round(float(cr)))
        for d, m, mp, f, cl, cr in re.findall(r"\{\s*" + r",\s*".join([num] * 6) + r"\}", tlr)
    ]
    b = [
        (int(d), int(m), int(mp), int(f), round(float(cb) * 1e6))
        for d, m, mp, f, cb in re.findall(r"\{\s*" + r",\s*".join([num] * 5) + r"\}", tb)
    ]
    return a, b


def go(text: str) -> tuple[list[tuple[int, ...]], list[tuple[int, ...]]]:
    ta = text[text.index("var ta") : text.index("type tbs")]
    tb = text[text.index("var tb") :]
    n = r"(-?\d+)"
    a = [tuple(map(int, row)) for row in re.findall(r"\{" + ", ".join([n] * 6) + r"\}", ta)]
    b = [tuple(map(int, row)) for row in re.findall(r"\{" + ", ".join([n] * 5) + r"\}", tb)]
    return a, b


def main() -> int:
    erfa_src, go_src = (sys.argv[1], sys.argv[2]) if len(sys.argv) == 3 else (ERFA_URL, GO_URL)
    mine_a, mine_b = ours()
    refs = {"erfa": erfa(read(erfa_src)), "meeus-go": go(read(go_src))}
    failures = 0
    for name, (ref_a, ref_b) in refs.items():
        for table, mine, ref in (("47.A", mine_a, ref_a), ("47.B", mine_b, ref_b)):
            if len(mine) != 60 or len(ref) != 60:
                print(f"{table}: expected 60 rows, ours {len(mine)}, {name} {len(ref)}")
                failures += 1
                continue
            for i, (row, other) in enumerate(zip(mine, ref)):
                if row != other:
                    print(f"{table} row {i + 1}: ours {row} != {name} {other}")
                    failures += 1
    print("OK: 240 rows match both references" if failures == 0 else f"{failures} mismatches")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
