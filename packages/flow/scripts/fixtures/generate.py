# /// script
# requires-python = ">=3.11"
# dependencies = ["pyinform>=0.2", "numpy>=1.26"]
# ///
"""Generate authoritative cross-check fixtures for @mindpeeker/flow.

Run manually (never at test time):

    uv run packages/flow/scripts/fixtures/generate.py

PyInform ships only an x86_64 dylib; on Apple Silicon run it under Rosetta:

    uv run --python cpython-3.11-macos-x86_64-none packages/flow/scripts/fixtures/generate.py

Pass fixture names (te, conditional, storage) to regenerate only
those; with no arguments every fixture is written.

Writes JSON files into packages/flow/test/fixtures/. Every fixture embeds its
symbol sequences — bun tests never reproduce a Python PRNG. The reference
implementation is PyInform (the inform C library): plug-in, base-2
transfer entropy with destination history k and a single source symbol at
lag 1 (optionally conditioned on background series at the source's time),
active information storage, entropy rate and block entropy. Embeddings PyInform
cannot express directly (source history l > 1, lag > 1, condition history or
lag > 1, predictive information) are reduced here to PyInform's
conditional_entropy / mutual_info over block codes packed in Python — an
implementation independent of the package's own key packing.
"""

import json
import platform
import sys
from importlib.metadata import version
from pathlib import Path

import numpy as np
from pyinform.activeinfo import active_info
from pyinform.blockentropy import block_entropy
from pyinform.conditionalentropy import conditional_entropy
from pyinform.entropyrate import entropy_rate
from pyinform.mutualinfo import mutual_info
from pyinform.transferentropy import transfer_entropy

OUT_DIR = Path(__file__).resolve().parents[2] / "test" / "fixtures"
GENERATOR = (
    f"python {platform.python_version()}, pyinform {version('pyinform')}, numpy {np.__version__}"
)


def write(name: str, payload: dict) -> None:
    payload = {"generator": GENERATOR, **payload}
    path = OUT_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {path}")


def coupled_pair(rng, n: int, alphabet: int, coupling: float):
    """y copies x's previous symbol with probability `coupling`, else is uniform."""
    x = rng.integers(0, alphabet, size=n)
    y = np.empty(n, dtype=np.int64)
    y[0] = rng.integers(0, alphabet)
    for t in range(1, n):
        y[t] = x[t - 1] if rng.random() < coupling else rng.integers(0, alphabet)
    return x, y


def te_fixture() -> None:
    rng = np.random.default_rng(20260708)
    pairs = [
        ("binary-coupled-0.9", *coupled_pair(rng, 1000, 2, 0.9)),
        ("binary-independent", rng.integers(0, 2, 800), rng.integers(0, 2, 800)),
        ("ternary-coupled-0.75", *coupled_pair(rng, 750, 3, 0.75)),
        ("quaternary-coupled-0.6", *coupled_pair(rng, 600, 4, 0.6)),
    ]
    cases = []
    for label, x, y in pairs:
        xs = [int(v) for v in x]
        ys = [int(v) for v in y]
        cases.append(
            {
                "label": label,
                "x": xs,
                "y": ys,
                "entropyX": float(block_entropy(xs, 1)),
                "entropyY": float(block_entropy(ys, 1)),
                "mutualInformation": float(mutual_info(xs, ys)),
                "te": [
                    {
                        "k": k,
                        "xy": float(transfer_entropy(xs, ys, k)),
                        "yx": float(transfer_entropy(ys, xs, k)),
                    }
                    for k in (1, 2, 3)
                ],
            }
        )
    write("te.json", {"cases": cases})


def ints(values) -> list[int]:
    return [int(v) for v in values]


def pack(series: list[list[int]], alphabet: int, offsets: list[int], length: int) -> list[int]:
    """Code, for every t in range(length), the tuple (series[j][t + offsets[j]])_j in base alphabet."""
    codes = []
    for t in range(length):
        code = 0
        for col, off in zip(series, offsets):
            code = code * alphabet + col[t + off]
        codes.append(code)
    # relabel densely: PyInform infers the alphabet from max + 1
    labels: dict[int, int] = {}
    return [labels.setdefault(c, len(labels)) for c in codes]


def te_by_blocks(x, y, conds, alphabet, k, l, lag, cond_k, cond_lag) -> tuple[float, int]:
    """TE(x -> y | conds) = H(Y+ | C) - H(Y+ | C, S) over block codes; C = (y^k, w^(condK)...)."""
    n = len(y)
    first = max(k - 1, lag + l - 2, (cond_lag + cond_k - 2) if conds else 0)
    count = n - 1 - first
    # tuple i <-> t = first + i
    cond_cols = [[y[first + i - d] for i in range(count)] for d in range(k)]
    for w in conds:
        cond_cols += [[w[first + i - (cond_lag - 1) - d] for i in range(count)] for d in range(cond_k)]
    src_cols = [[x[first + i - (lag - 1) - d] for i in range(count)] for d in range(l)]
    target = [y[first + 1 + i] for i in range(count)]
    c = pack(cond_cols, alphabet, [0] * len(cond_cols), count)
    cs = pack(cond_cols + src_cols, alphabet, [0] * (len(cond_cols) + l), count)
    return float(conditional_entropy(c, target) - conditional_entropy(cs, target)), count


def conditional_fixture() -> None:
    rng = np.random.default_rng(20260917)
    cases = []
    # PyInform's documented example
    cases.append({
        "label": "pyinform-doc",
        "x": [0, 1, 1, 1, 1, 0, 0, 0, 0],
        "y": [0, 0, 1, 1, 1, 1, 0, 0, 0],
        "conditions": [[0, 1, 1, 1, 1, 0, 1, 1, 1]],
        "k": 2,
        "te": float(transfer_entropy([0, 1, 1, 1, 1, 0, 0, 0, 0], [0, 0, 1, 1, 1, 1, 0, 0, 0], 2,
                                     condition=[0, 1, 1, 1, 1, 0, 1, 1, 1])),
    })
    for label, n, alphabet, n_cond, k in [
        ("binary-1cond", 900, 2, 1, 1),
        ("binary-2cond-k2", 1200, 2, 2, 2),
        ("ternary-1cond-k2", 1500, 3, 1, 2),
    ]:
        w = [rng.integers(0, alphabet, n) for _ in range(n_cond)]
        x = rng.integers(0, alphabet, n)
        y = np.empty(n, dtype=np.int64)
        y[0] = 0
        for t in range(1, n):
            r = rng.random()
            y[t] = x[t - 1] if r < 0.4 else (w[0][t - 1] if r < 0.7 else rng.integers(0, alphabet))
        cond = np.array(w) if n_cond > 1 else w[0]
        cases.append({
            "label": label,
            "x": ints(x),
            "y": ints(y),
            "conditions": [ints(c) for c in w],
            "k": k,
            "te": float(transfer_entropy(ints(x), ints(y), k, condition=cond)),
        })
    # embeddings beyond PyInform's API, via block codes
    blocks = []
    for label, n, alphabet, k, l, lag, cond_k, cond_lag in [
        ("l2-lag2", 1000, 2, 1, 2, 2, 1, 1),
        ("k2-l2-lag3-condK2-condLag2", 2000, 2, 2, 2, 3, 2, 2),
        ("ternary-l1-lag2-condLag3", 1500, 3, 1, 1, 2, 1, 3),
    ]:
        x = ints(rng.integers(0, alphabet, n))
        w = ints(rng.integers(0, alphabet, n))
        y = [0] * n
        for t in range(3, n):
            r = rng.random()
            y[t] = x[t - lag] if r < 0.5 else (w[t - cond_lag] if r < 0.75 else int(rng.integers(0, alphabet)))
        te_plain, count_plain = te_by_blocks(x, y, [], alphabet, k, l, lag, cond_k, cond_lag)
        te_cond, count_cond = te_by_blocks(x, y, [w], alphabet, k, l, lag, cond_k, cond_lag)
        blocks.append({
            "label": label, "x": x, "y": y, "w": w, "k": k, "l": l, "lag": lag,
            "condK": cond_k, "condLag": cond_lag,
            "te": te_plain, "count": count_plain, "cte": te_cond, "cteCount": count_cond,
        })
    write("conditional.json", {"cases": cases, "blocks": blocks})


def storage_fixture() -> None:
    rng = np.random.default_rng(20260918)
    doc = [0, 0, 1, 1, 1, 1, 0, 0, 0]
    cases = [{
        "label": "pyinform-doc",
        "x": doc,
        "alphabet": 2,
        "measures": [{
            "k": 2,
            "activeInfo": float(active_info(doc, 2)),
            "localActiveInfo": [float(v) for v in np.ravel(active_info(doc, 2, local=True))],
            "entropyRate": float(entropy_rate(doc, 2)),
            "blockEntropy": float(block_entropy(doc, 2)),
        }],
    }]
    # a sticky Markov chain (strong storage) and iid noise
    n = 2000
    sticky = [0]
    for _ in range(n - 1):
        sticky.append(sticky[-1] if rng.random() < 0.85 else int(rng.integers(0, 3)))
    for label, series, alphabet in [
        ("ternary-sticky", sticky, 3),
        ("quaternary-iid", ints(rng.integers(0, 4, 1500)), 4),
    ]:
        measures = []
        for k in (1, 2, 3):
            kf = 2
            count = len(series) - k - kf + 1
            past = pack([series] * k, alphabet, list(range(k)), count)
            future = pack([series] * kf, alphabet, [k + j for j in range(kf)], count)
            measures.append({
                "k": k,
                "activeInfo": float(active_info(series, k)),
                "entropyRate": float(entropy_rate(series, k)),
                "blockEntropy": float(block_entropy(series, k)),
                "predictiveInfo2": float(mutual_info(past, future)),
            })
        cases.append({"label": label, "x": ints(series), "alphabet": alphabet, "measures": measures})
    write("storage.json", {"cases": cases})


FIXTURES = {"te": te_fixture, "conditional": conditional_fixture, "storage": storage_fixture}

if __name__ == "__main__":
    for name in sys.argv[1:] or list(FIXTURES):
        FIXTURES[name]()
