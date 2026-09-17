# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Generate authoritative test fixtures for @mindpeeker/vdf (protocol v2).

An independent Python mirror of the protocol's byte-level encoding (hashlib
SHA-256 + integer arithmetic): canonical signed quadratic residues
(|a| = min(a, n - a)), the modulus-bound transcript, the hashToGroup counter-mode
expansion, Fiat-Shamir challenges, the Wesolowski hash-to-prime, modulus
fingerprints, evaluate() outputs via the Euler shortcut x^(2^T) = x^(2^T mod
phi(n)) on known-factorization moduli, full Pietrzak and Wesolowski proofs, and
the proof/seal wire formats. Any divergence between the TypeScript implementation
and these fixtures is a wire-format bug.

Run manually (never at test time):

    uv run packages/vdf/scripts/fixtures/generate.py

Writes JSON into packages/vdf/test/fixtures/. Bigints are decimal strings.
"""

import hashlib
import json
import math
import platform
import random
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parents[2] / "test" / "fixtures"
GENERATOR = f"python {platform.python_version()}, hashlib sha256 (no third-party deps)"

TAG = b"mindpeeker-vdf-v2"
VERSION = 0x02
KIND_PIETRZAK, KIND_WESOLOWSKI, KIND_SEAL = 0x50, 0x57, 0x53

# The known-factorization 256-bit test modulus (two 128-bit safe primes,
# both = 3 mod 4). Must match test/helpers/test-modulus.ts.
P = 273352122251145161663493244090143900227
Q = 300502300844854219335184493716718087999
N = P * Q
PHI = (P - 1) * (Q - 1)

RSA2048 = int(
    "2519590847565789349402718324004839857142928212620403202777713783604366202070"
    "7595556264018525880784406918290641249515082189298559149176184502808489120072"
    "8449926873928072877767359714183472702618963750149718246911650776133798590957"
    "0009733045974880842840179742910064245869181719511874612151517265463228221686"
    "9987549182422433637259085141865462043576798423387184774447920739934236584823"
    "8242811981638150106748104516603773060562016196762561338441436038339044149526"
    "3443219011465754445417842402092461651572335077870774981712577246796292638635"
    "6373289912154831438167899885040445364023527381951378636564391212010397122822"
    "120720357"
)

MR_BASES = [p for p in range(2, 132) if all(p % d for d in range(2, p))]
assert len(MR_BASES) == 32 and MR_BASES[-1] == 131
FILTER_PRIMES = [p for p in range(2, 2000) if all(p % d for d in range(2, math.isqrt(p) + 1))]


def lp(field: bytes) -> bytes:
    """Length-prefixed field: u32 big-endian byte count, then the bytes."""
    return len(field).to_bytes(4, "big") + field


def byte_length(n: int) -> int:
    return max(1, (n.bit_length() + 7) // 8)


def transcript(context: str, n: int, fields: list[bytes]) -> bytes:
    return lp(TAG) + lp(context.encode()) + lp(n.to_bytes(byte_length(n), "big")) + b"".join(
        lp(f) for f in fields
    )


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def canon(a: int, n: int) -> int:
    return min(a, n - a)


def hash_to_group(inp: bytes, n: int) -> int:
    width = byte_length(n)
    blocks = b"".join(
        sha256(transcript("group", n, [inp, i.to_bytes(4, "big")]))
        for i in range((width + 31) // 32)
    )
    h = int.from_bytes(blocks[:width], "big") % n
    return canon(h * h % n, n)


def challenge(x: int, y: int, mu: int, t: int, n: int) -> int:
    w = byte_length(n)
    digest = sha256(
        transcript(
            "challenge",
            n,
            [x.to_bytes(w, "big"), y.to_bytes(w, "big"), mu.to_bytes(w, "big"), t.to_bytes(4, "big")],
        )
    )
    return int.from_bytes(digest[:16], "big")


def strong_probable_prime(n: int, a: int) -> bool:
    d, s = n - 1, 0
    while d % 2 == 0:
        d //= 2
        s += 1
    x = pow(a, d, n)
    if x in (1, n - 1):
        return True
    for _ in range(s - 1):
        x = x * x % n
        if x == n - 1:
            return True
    return False


def is_probable_prime(n: int) -> bool:
    """Mirror of the fixed-base procedure (trial division < 2000, 32 fixed MR bases)."""
    if n < 2:
        return False
    for p in FILTER_PRIMES:
        if n == p:
            return True
        if n % p == 0:
            return False
    if n < 2000 * 2000:
        return True
    return all(strong_probable_prime(n, a) for a in MR_BASES)


RNG = random.Random(20260917)


def assert_prime_independently(n: int) -> None:
    """40 extra random-base rounds, independent of the fixed bases."""
    for _ in range(40):
        assert strong_probable_prime(n, RNG.randrange(2, n - 1)), "random-base MR disagrees"


def hash_to_prime(x: int, y: int, t: int, n: int) -> int:
    w = byte_length(n)
    fields = [x.to_bytes(w, "big"), y.to_bytes(w, "big"), t.to_bytes(4, "big")]
    j = 0
    while True:
        c = int.from_bytes(sha256(transcript("prime", n, fields + [j.to_bytes(4, "big")])), "big")
        c |= (1 << 255) | 1
        if is_probable_prime(c):
            assert_prime_independently(c)
            return c
        j += 1


def fingerprint(n: int) -> bytes:
    return sha256(transcript("modulus", n, []))[:8]


def power_2t(x: int, t: int, n: int, phi: int | None) -> int:
    """x^(2^t) mod n: Euler shortcut when phi is known, direct squaring otherwise."""
    if phi is not None:
        assert math.gcd(x, n) == 1, "shortcut needs gcd(x, n) = 1"
        return pow(x, pow(2, t, phi), n)
    for _ in range(t):
        x = x * x % n
    return x


def evaluate(inp: bytes, t: int, n: int, phi: int | None) -> tuple[int, int]:
    x = hash_to_group(inp, n)
    return x, canon(power_2t(x, t, n, phi), n)


def prove(inp: bytes, big_t: int, n: int, phi: int | None) -> dict:
    """Pietrzak halving proof in QR_n^+, midpoints via the shortcut."""
    x, y = evaluate(inp, big_t, n, phi)
    xi, yi, ti = x, y, big_t
    mus = []
    while ti > 1:
        half = (ti + 1) // 2
        mu = canon(power_2t(xi, half, n, phi), n)
        r = challenge(xi, yi, mu, ti, n)
        if ti % 2 == 1:
            yi = canon(yi * yi % n, n)
        xi = canon(pow(xi, r, n) * mu % n, n)
        yi = canon(pow(mu, r, n) * yi % n, n)
        ti = half
        mus.append(mu)
    assert yi == canon(xi * xi % n, n), "python prover self-check failed"
    return {"inputHex": inp.hex(), "T": big_t, "y": str(y), "mus": [str(mu) for mu in mus]}


def wesolowski(inp: bytes, big_t: int, n: int, phi: int | None) -> dict:
    x, y = evaluate(inp, big_t, n, phi)
    ell = hash_to_prime(x, y, big_t, n)
    pi = canon(pow(x, (1 << big_t) // ell, n), n)
    r = pow(2, big_t, ell)
    assert canon(pow(pi, ell, n) * pow(x, r, n) % n, n) == y, "python Wesolowski self-check failed"
    return {"inputHex": inp.hex(), "T": big_t, "y": str(y), "ell": str(ell), "pi": str(pi)}


def header(kind: int, n: int) -> bytes:
    return bytes([VERSION, kind]) + fingerprint(n)


def proof_bytes(p: dict, n: int) -> str:
    w = byte_length(n)
    body = int(p["y"]).to_bytes(w, "big") + b"".join(int(m).to_bytes(w, "big") for m in p["mus"])
    return (header(KIND_PIETRZAK, n) + p["T"].to_bytes(4, "big") + body).hex()


def wesolowski_bytes(p: dict, n: int) -> str:
    w = byte_length(n)
    body = int(p["y"]).to_bytes(w, "big") + int(p["pi"]).to_bytes(w, "big")
    return (header(KIND_WESOLOWSKI, n) + p["T"].to_bytes(4, "big") + body).hex()


def seal_bytes(pulse: bytes, p: dict, n: int) -> str:
    w = byte_length(n)
    body = int(p["y"]).to_bytes(w, "big") + b"".join(int(m).to_bytes(w, "big") for m in p["mus"])
    return (header(KIND_SEAL, n) + sha256(pulse) + p["T"].to_bytes(4, "big") + body).hex()


def blum_prime(label: bytes, bits: int) -> int:
    """Deterministic prime = 3 mod 4 with exactly `bits` bits, derived from SHA-256(label)."""
    seed = int.from_bytes(hashlib.sha512(label).digest() * 2, "big")
    c = (seed >> (1024 - bits)) | (1 << (bits - 1)) | 3
    while not is_probable_prime(c):
        c += 4
    assert_prime_independently(c)
    return c


def main() -> None:
    inputs = [b"", b"\x00", b"pulse-1", bytes(range(32))]

    hash_to_group_cases = [{"inputHex": i.hex(), "x": str(hash_to_group(i, N))} for i in inputs]

    evaluate_cases = []
    for inp in (b"pulse-1", bytes(range(32))):
        for t in (1, 2, 3, 7, 8, 1000, 4096):
            evaluate_cases.append({"inputHex": inp.hex(), "T": t, "y": str(evaluate(inp, t, N, PHI)[1])})

    a = hash_to_group(b"challenge-x", N)
    b = hash_to_group(b"challenge-y", N)
    c = hash_to_group(b"challenge-mu", N)
    challenge_cases = [
        {"x": str(a), "y": str(b), "mu": str(c), "T": t, "r": str(challenge(a, b, c, t, N))}
        for t in (1, 5, 4096)
    ]

    proof_cases = [prove(b"pulse-1", t, N, PHI) for t in (1, 7, 8, 1000)]
    wesolowski_cases = [wesolowski(b"pulse-1", t, N, PHI) for t in (1, 7, 64, 1000, 4096)]

    seal_pulse = b"nist-pulse 2026-07-08T12:00:00Z"
    seal_proof = prove(seal_pulse, 8, N, PHI)

    # A 3-block modulus whose bit length is not a multiple of 8 (byte-width rounding).
    p_odd = blum_prime(b"mindpeeker-vdf fixture p", 261)
    q_odd = blum_prime(b"mindpeeker-vdf fixture q", 261)
    n_odd = p_odd * q_odd
    phi_odd = (p_odd - 1) * (q_odd - 1)
    assert n_odd.bit_length() % 8 != 0 and byte_length(n_odd) > 64

    write(
        "vdf.json",
        {
            "modulus": {"p": str(P), "q": str(Q), "n": str(N)},
            "fingerprint": fingerprint(N).hex(),
            "hashToGroup": hash_to_group_cases,
            "evaluate": evaluate_cases,
            "challenges": challenge_cases,
            "proofs": proof_cases,
            "wesolowski": wesolowski_cases,
            "wire": {
                "pietrzak": {"proofIndex": 1, "hex": proof_bytes(proof_cases[1], N)},
                "wesolowski": {"proofIndex": 3, "hex": wesolowski_bytes(wesolowski_cases[3], N)},
                "seal": {
                    "pulseHex": seal_pulse.hex(),
                    "T": 8,
                    "y": seal_proof["y"],
                    "mus": seal_proof["mus"],
                    "hex": seal_bytes(seal_pulse, seal_proof, N),
                },
            },
            "rsa2048": {
                "fingerprint": fingerprint(RSA2048).hex(),
                "hashToGroup": {"inputHex": b"pulse-1".hex(), "x": str(hash_to_group(b"pulse-1", RSA2048))},
                "proof": prove(b"pulse-1", 64, RSA2048, None),
                "wesolowski": wesolowski(b"pulse-1", 64, RSA2048, None),
            },
            "oddWidth": {
                "p": str(p_odd),
                "q": str(q_odd),
                "n": str(n_odd),
                "bits": n_odd.bit_length(),
                "hashToGroup": {"inputHex": b"pulse-1".hex(), "x": str(hash_to_group(b"pulse-1", n_odd))},
                "proof": prove(b"pulse-1", 100, n_odd, phi_odd),
                "proofHex": proof_bytes(prove(b"pulse-1", 100, n_odd, phi_odd), n_odd),
                "wesolowski": wesolowski(b"pulse-1", 100, n_odd, phi_odd),
            },
        },
    )


def write(name: str, payload: dict) -> None:
    payload = {"generator": GENERATOR, **payload}
    path = OUT_DIR / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
