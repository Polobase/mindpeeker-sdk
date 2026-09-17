"""Signed-note / checkpoint vectors for @mindpeeker/ledger, checked independently.

Collects published Ed25519 signed-note vectors and one live transparency-log
checkpoint, verifies every signature with the `cryptography` package (not the
code under test), and writes test/fixtures/notes.json with the verdicts.

Sources:
- golang.org/x/mod/sumdb/note note_test.go (BSD-3-Clause, The Go Authors):
  PeterNeumann and EnochRoot keys and signatures.
- c2sp.org/signed-note example: example.com/foo.
- https://sum.golang.org/latest checkpoint (Go checksum database), verifier key
  from src/cmd/go/internal/modfetch/key.go. Pass --fetch to capture a fresh one.

Usage: uv run --with cryptography python3 packages/ledger/scripts/fixtures/notes.py [--fetch]
"""

import base64
import hashlib
import json
import pathlib
import struct
import sys
import urllib.request

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

FIXTURE = pathlib.Path(__file__).resolve().parents[2] / 'test' / 'fixtures' / 'notes.json'
EM = '—'

GO_TEXT = ("If you think cryptography is the answer to your problem,\n"
           "then you don't know what your problem is.\n")
PETER_KEY = 'PeterNeumann+c74f20a3+ARpc2QcUPDhMQegwxbzhKqiBfsVkmqq/LDE4izWy10TW'
ENOCH_KEY = 'EnochRoot+af0cfe78+ATtqJ7zOtqQtYqOo0CpvDXNlMhV3HeJDpjrASKGLWdop'
PETER_SIG = f'{EM} PeterNeumann x08go/ZJkuBS9UG/SffcvIAQxVBtiFupLLr8pAcElZInNIuGUgYN1FFYC2pZSNXgKvqfqdngotpRZb6KE6RyyBwJnAM=\n'
ENOCH_SIG = f'{EM} EnochRoot rwz+eBzmZa0SO3NbfRGzPCpDckykFXSdeX+MNtCOXm2/5n2tiOHp+vAF1aGrQ5ovTG01oOTGwnWLox33WWd1RvMc+QQ=\n'
FOO_KEY = 'example.com/foo+530d903a+AekyeRrm56hApGFkyQR4ZCbV54Id2LKaANYcrnKv3U2k'
FOO_NOTE = ('This is an example message.\n\n'
            f'{EM} example.com/foo Uw2QOkn8srV1yJGh2VYRlL1Tnagv1YEq6TfXppzi2ONncAlTgK7Ztg1ERYNZXsYjOBH3mFXmRKuwHjG1Yu72IneyaQM=\n')
SUMDB_KEY = 'sum.golang.org+033de0ae+Ac4zctda0e5eza+HJyk9SxEdh+s3Ux18htTTAD8OuAn8'


def parse_vkey(vkey: str):
    name, key_id, material = vkey.split('+', 2)
    raw = base64.b64decode(material, validate=True)
    assert raw[0] == 1 and len(raw) == 33
    assert hashlib.sha256(name.encode() + b'\n' + raw).digest()[:4].hex() == key_id
    return name, int(key_id, 16), raw[1:]


def verdicts(note: str, vkeys: list) -> dict:
    keys = [parse_vkey(v) for v in vkeys]
    split = note.rindex('\n\n')
    text = note[: split + 1].encode()
    result = {}
    for line in note[split + 2:].rstrip('\n').split('\n'):
        name, b64 = line[2:].split(' ')
        sig = base64.b64decode(b64, validate=True)
        key_id = struct.unpack('>I', sig[:4])[0]
        match = [k for k in keys if k[0] == name and k[1] == key_id]
        if not match:
            result[name] = 'unknown'
            continue
        try:
            Ed25519PublicKey.from_public_bytes(match[0][2]).verify(sig[4:], text)
            result[name] = 'verified'
        except InvalidSignature:
            result[name] = 'failed'
    return result


def main() -> None:
    old = json.loads(FIXTURE.read_text()) if FIXTURE.exists() else {}
    checkpoint = old.get('sumdb', {}).get('checkpoint')
    captured = old.get('sumdb', {}).get('captured')
    if '--fetch' in sys.argv or checkpoint is None:
        with urllib.request.urlopen('https://sum.golang.org/latest') as response:
            checkpoint = response.read().decode('utf-8')
        captured = input('capture date (YYYY-MM-DD): ').strip()
    go_note = GO_TEXT + '\n' + PETER_SIG + ENOCH_SIG
    out = {
        'generator': 'packages/ledger/scripts/fixtures/notes.py (verdicts from pyca/cryptography)',
        'go': {
            'source': 'golang.org/x/mod/sumdb/note/note_test.go (BSD-3-Clause, The Go Authors)',
            'text': GO_TEXT,
            'note': go_note,
            'keys': {'peter': PETER_KEY, 'enoch': ENOCH_KEY},
            'verdicts': verdicts(go_note, [PETER_KEY, ENOCH_KEY]),
        },
        'c2sp': {
            'source': 'https://c2sp.org/signed-note (editor copy, Example section)',
            'note': FOO_NOTE,
            'key': FOO_KEY,
            'verdicts': verdicts(FOO_NOTE, [FOO_KEY]),
        },
        'sumdb': {
            'source': 'https://sum.golang.org/latest; key from go/src/cmd/go/internal/modfetch/key.go',
            'captured': captured,
            'checkpoint': checkpoint,
            'key': SUMDB_KEY,
            'verdicts': verdicts(checkpoint, [SUMDB_KEY]),
        },
    }
    for section in ('go', 'c2sp', 'sumdb'):
        assert all(v == 'verified' for v in out[section]['verdicts'].values()), out[section]
    FIXTURE.write_text(json.dumps(out, indent=2, ensure_ascii=False) + '\n')
    print(f'wrote {FIXTURE}')


if __name__ == '__main__':
    main()
