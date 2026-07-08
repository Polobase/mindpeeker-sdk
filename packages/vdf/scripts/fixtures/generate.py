# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Generate authoritative test fixtures for @mindpeeker/vdf.

An independent Python mirror of the protocol's byte-level encoding (hashlib
SHA-256 + integer arithmetic): the hashToGroup counter-mode expansion, the
Fiat-Shamir challenge transcript, evaluate() outputs via the Euler shortcut
x^(2^T) = x^(2^T mod phi(n)) mod n on the known-factorization test modulus,
and full Pietrzak proofs (midpoints computed with the same shortcut). Any
divergence between the TypeScript implementation and these fixtures is a
wire-format bug.

Run manually (never at test time):

    uv run packages/vdf/scripts/fixtures/generate.py

Writes JSON into packages/vdf/test/fixtures/. Bigints are decimal strings.
"""

import hashlib
import json
import math
import platform
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[2] / "test" / "fixtures"
GENERATOR = f"python {platform.python_version()}, hashlib sha256 (no third-party deps)"

TAG = b"mindpeeker-vdf-v1"

# The known-factorization 256-bit test modulus (two 128-bit safe primes,
# both = 3 mod 4). Must match test/helpers/test-modulus.ts.
P = 273352122251145161663493244090143900227
Q = 300502300844854219335184493716718087999
N = P * Q
PHI = (P - 1) * (Q - 1)


def lp(field: bytes) -> bytes:
    """Length-prefixed field: u32 big-endian byte count, then the bytes."""
    return len(field).to_bytes(4, "big") + field


def transcript(context: str, fields: list[bytes]) -> bytes:
    return lp(TAG) + lp(context.encode()) + b"".join(lp(f) for f in fields)


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def byte_length(n: int) -> int:
    return max(1, (n.bit_length() + 7) // 8)


def hash_to_group(inp: bytes, n: int) -> int:
    width = byte_length(n)
    blocks = b"".join(
        sha256(transcript("group", [inp, i.to_bytes(4, "big")]))
        for i in range((width + 31) // 32)
    )
    h = int.from_bytes(blocks[:width], "big") % n
    return (h * h) % n


def challenge(x: int, y: int, mu: int, t: int, n: int) -> int:
    width = byte_length(n)
    digest = sha256(
        transcript(
            "challenge",
            [
                x.to_bytes(width, "big"),
                y.to_bytes(width, "big"),
                mu.to_bytes(width, "big"),
                t.to_bytes(4, "big"),
            ],
        )
    )
    return int.from_bytes(digest[:16], "big")


def shortcut_power(x: int, t: int) -> int:
    """x^(2^t) mod N via Euler: valid because gcd(x, N) == 1 is asserted."""
    assert math.gcd(x, N) == 1, "shortcut needs gcd(x, N) = 1"
    return pow(x, pow(2, t, PHI), N)


def prove(inp: bytes, big_t: int) -> dict:
    """Pietrzak halving proof, midpoints via the phi shortcut."""
    x = hash_to_group(inp, N)
    y = shortcut_power(x, big_t)
    xi, yi, ti = x, y, big_t
    mus = []
    while ti > 1:
        half = (ti + 1) // 2
        mu = shortcut_power(xi, half)
        r = challenge(xi, yi, mu, ti, N)
        if ti % 2 == 1:
            yi = yi * yi % N
        xi = pow(xi, r, N) * mu % N
        yi = pow(mu, r, N) * yi % N
        ti = half
        mus.append(mu)
    assert yi == xi * xi % N, "python prover self-check failed"
    return {
        "inputHex": inp.hex(),
        "T": big_t,
        "y": str(y),
        "mus": [str(mu) for mu in mus],
    }


def write(name: str, payload: dict) -> None:
    payload = {"generator": GENERATOR, **payload}
    path = OUT_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {path}")


def main() -> None:
    inputs = [b"", b"\x00", b"pulse-1", bytes(range(32))]

    hash_to_group_cases = [
        {"inputHex": inp.hex(), "x": str(hash_to_group(inp, N))} for inp in inputs
    ]

    evaluate_cases = []
    for inp in (b"pulse-1", bytes(range(32))):
        x = hash_to_group(inp, N)
        for t in (1, 2, 3, 7, 8, 1000, 4096):
            evaluate_cases.append(
                {"inputHex": inp.hex(), "T": t, "y": str(shortcut_power(x, t))}
            )

    a = hash_to_group(b"challenge-x", N)
    b = hash_to_group(b"challenge-y", N)
    c = hash_to_group(b"challenge-mu", N)
    challenge_cases = [
        {"x": str(a), "y": str(b), "mu": str(c), "T": t, "r": str(challenge(a, b, c, t, N))}
        for t in (1, 5, 4096)
    ]

    proof_cases = [prove(b"pulse-1", t) for t in (1, 7, 8, 1000)]

    write(
        "vdf.json",
        {
            "modulus": {"p": str(P), "q": str(Q), "n": str(N)},
            "hashToGroup": hash_to_group_cases,
            "evaluate": evaluate_cases,
            "challenges": challenge_cases,
            "proofs": proof_cases,
        },
    )


if __name__ == "__main__":
    main()
