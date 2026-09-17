"""Known-answer tests for @mindpeeker/ledger records (Python stdlib only).

Recomputes, independently of the TypeScript code under test:
- commitments SHA-256(b"mindpeeker-ledger-commit" || LP(value) || LP(nonce)),
  LP(x) = u64be(len(x)) || x, and combineReveals (XOR, and the beacon mix
  SHA-256(b"mindpeeker-ledger-combine" || LP(xor) || LP(beacon)));
- ledger chain lines canonical({i, prev, record}) and heads;
- a registration's canonical envelope and hash, a time bracket's seal input
  and hash.

Canonical JSON here is json.dumps(sort_keys=True, separators=(',', ':'),
ensure_ascii=False), which equals RFC 8785 for the ASCII keys, integers and
short decimals used below (Python sorts by code point, JCS by UTF-16 code
unit; they agree on the BMP).

Usage: python3 packages/ledger/scripts/fixtures/records.py
"""

import hashlib
import json
import pathlib
import struct

OUT = pathlib.Path(__file__).resolve().parents[2] / 'test' / 'fixtures' / 'records-kat.json'
ZERO = '0' * 64


def canon(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def lp(data: bytes) -> bytes:
    return struct.pack('>Q', len(data)) + data


def commit(value: bytes, nonce: bytes) -> str:
    return sha(b'mindpeeker-ledger-commit' + lp(value) + lp(nonce))


def chain(genesis: str, records: list) -> dict:
    head, lines = genesis, []
    for i, record in enumerate(records):
        line = canon({'i': i, 'prev': head, 'record': record})
        lines.append(line)
        head = sha(line.encode())
    return {'genesis': genesis, 'records': records, 'lines': lines, 'head': head}


def main() -> None:
    commits = []
    for value, nonce in [
        (b'', bytes(range(16))),
        (b'H', bytes(32)),
        ('intention order: HLB'.encode(), bytes(range(100, 132))),
        (bytes(range(256)), bytes([255] * 20)),
    ]:
        commits.append({'valueHex': value.hex(), 'nonceHex': nonce.hex(),
                        'commitment': commit(value, nonce)})
    a = bytes(range(32))
    b = bytes((7 * i + 3) % 256 for i in range(32))
    c = bytes((i * i) % 256 for i in range(32))
    xor = bytes(x ^ y ^ z for x, y, z in zip(a, b, c))
    beacon = bytes.fromhex('d0' * 32)
    combine = {
        'valuesHex': [a.hex(), b.hex(), c.hex()],
        'xorHex': xor.hex(),
        'beaconHex': beacon.hex(),
        'mixedHex': sha(b'mindpeeker-ledger-combine' + lp(xor) + lp(beacon)),
    }
    plan_hash = sha('analysis plan v1: one-sided z test of deltaZ\n'.encode())
    registration = {
        'title': 'Tripolar REG replication – pilot',
        'authors': ['A. Operator', 'B. Skeptic'],
        'hypotheses': [
            {'id': 'H1', 'statement': 'HI-LO separation exceeds chance', 'kind': 'confirmatory',
             'statistic': 'deltaZ = (zHI - zLO) / sqrt(2)', 'null': 'N(0, 1)',
             'direction': 'greater'},
            {'id': 'E1', 'statement': 'Baseline variance differs from binomial',
             'kind': 'exploratory'},
        ],
        'primary': 'H1',
        'alpha': 0.05,
        'sample': {'kind': 'fixed', 'size': 3000, 'unit': 'trials'},
        'analysisPlanHash': plan_hash,
        'exclusions': ['runs aborted by a source health failure'],
        'dataSources': [
            {'name': 'truerng-3', 'role': 'experimental'},
            {'name': 'hmac-drbg', 'role': 'control', 'description': 'seeded CSPRNG control arm'},
        ],
    }
    reg_canonical = canon({'schema': 'mindpeeker-ledger/registration/1',
                           'registration': registration})
    reg_hash = sha(reg_canonical.encode())
    bracket = {
        'registrationHash': reg_hash,
        'notBefore': {'beacon': {
            'source': 'drand',
            'chain': '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
            'round': 23456789,
            'timestamp': '2026-09-17T12:00:00Z',
            'valueHex': 'ab' * 32,
        }},
        'notAfter': {'kind': 'rekor', 'ref': '108e9186e8c5677a'},
    }
    seal_input = canon({'schema': 'mindpeeker-ledger/time-bracket-seal/1',
                        'registrationHash': bracket['registrationHash'],
                        'notBefore': bracket['notBefore']})
    out = {
        'generator': 'packages/ledger/scripts/fixtures/records.py (hashlib, json)',
        'commits': commits,
        'combine': combine,
        'chains': [
            chain(ZERO, [{'n': 1}, 'second', [1, 2, 3], None, {'nested': {'b': True, 'a': 0.5}}]),
            chain(reg_hash, [{'event': 'session-start', 'sources': ['alpha', 'beta']}]),
        ],
        'registration': {'value': registration, 'canonical': reg_canonical, 'hash': reg_hash},
        'bracket': {
            'value': bracket,
            'sealInput': seal_input,
            'hash': sha(canon({'schema': 'mindpeeker-ledger/time-bracket/1',
                               'bracket': bracket}).encode()),
        },
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + '\n')
    print(f'wrote {OUT}')


if __name__ == '__main__':
    main()
