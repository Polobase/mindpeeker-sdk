"""Independent RFC 6962 Merkle fixtures for @mindpeeker/ledger (Python stdlib only).

Implements RFC 6962 §2.1 literally — MTH, PATH (§2.1.1) and PROOF/SUBPROOF
(§2.1.2) as the recursive definitions, hashlib SHA-256 — and writes
test/fixtures/merkle-rfc6962.json:

- leaves 0..63 (hex): the eight transparency-dev/certificate-transparency test
  inputs, then b"mindpeeker-ledger leaf <j>" for j >= 8;
- roots of every prefix size 0..64;
- every inclusion proof and every consistency proof (1 <= m <= n) for n <= 16, in full;
- for 17 <= n <= 64, SHA-256 digests over all inclusion proofs (index 0..n-1)
  and all consistency proofs (m 1..n) of that size, each proof encoded as
  u32be(node count) || nodes.

Usage: python3 packages/ledger/scripts/fixtures/merkle.py
"""

import hashlib
import json
import pathlib
import struct

OUT = pathlib.Path(__file__).resolve().parents[2] / 'test' / 'fixtures' / 'merkle-rfc6962.json'
CT_LEAVES = ['', '00', '10', '2021', '3031', '40414243', '5051525354555657',
             '606162636465666768696a6b6c6d6e6f']
FULL_UP_TO = 16
MAX_SIZE = 64


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def k_of(n: int) -> int:
    """Largest power of two strictly smaller than n (n >= 2)."""
    k = 1
    while k * 2 < n:
        k *= 2
    return k


def mth(d: list) -> bytes:
    n = len(d)
    if n == 0:
        return sha256(b'')
    if n == 1:
        return sha256(b'\x00' + d[0])
    k = k_of(n)
    return sha256(b'\x01' + mth(d[:k]) + mth(d[k:]))


def path(m: int, d: list) -> list:
    n = len(d)
    if n == 1:
        return []
    k = k_of(n)
    if m < k:
        return path(m, d[:k]) + [mth(d[k:])]
    return path(m - k, d[k:]) + [mth(d[:k])]


def subproof(m: int, d: list, b: bool) -> list:
    n = len(d)
    if m == n:
        return [] if b else [mth(d)]
    k = k_of(n)
    if m <= k:
        return subproof(m, d[:k], b) + [mth(d[k:])]
    return subproof(m - k, d[k:], False) + [mth(d[:k])]


def proof(m: int, d: list) -> list:
    return subproof(m, d, True)


def encode(nodes: list) -> bytes:
    return struct.pack('>I', len(nodes)) + b''.join(nodes)


def main() -> None:
    leaves = [bytes.fromhex(h) for h in CT_LEAVES]
    leaves += [f'mindpeeker-ledger leaf {j}'.encode() for j in range(8, MAX_SIZE)]
    out = {
        'generator': 'packages/ledger/scripts/fixtures/merkle.py (RFC 6962 recursions, hashlib)',
        'leaves': [leaf.hex() for leaf in leaves],
        'roots': [mth(leaves[:n]).hex() for n in range(MAX_SIZE + 1)],
        'inclusion': [],
        'consistency': [],
        'digests': [],
    }
    for n in range(1, FULL_UP_TO + 1):
        d = leaves[:n]
        for index in range(n):
            out['inclusion'].append({'size': n, 'index': index,
                                     'proof': [x.hex() for x in path(index, d)]})
        for m in range(1, n + 1):
            out['consistency'].append({'m': m, 'n': n,
                                       'proof': [x.hex() for x in proof(m, d)]})
    for n in range(FULL_UP_TO + 1, MAX_SIZE + 1):
        d = leaves[:n]
        incl = sha256(b''.join(encode(path(i, d)) for i in range(n)))
        cons = sha256(b''.join(encode(proof(m, d)) for m in range(1, n + 1)))
        out['digests'].append({'size': n, 'inclusion': incl.hex(), 'consistency': cons.hex()})
    OUT.write_text(json.dumps(out, indent=2) + '\n')
    print(f'wrote {OUT}')


if __name__ == '__main__':
    main()
