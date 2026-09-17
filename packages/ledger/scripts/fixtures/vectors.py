"""Fetch third-party test vectors for @mindpeeker/ledger (Python stdlib only).

Writes, with source URL, commit ref and licence recorded in each file:

- test/fixtures/jcs-cyberphone.json — the RFC 8785 reference test data
  (github.com/cyberphone/json-canonicalization, testdata/input + output;
  Apache-2.0, Copyright 2018 Anders Rundgren). RFC 8785 Appendix I names this
  repository as the source of JCS test data.
- test/fixtures/merkle-probes.json — transparency-dev/merkle
  testdata/inclusion and testdata/consistency probes (Apache-2.0, Copyright
  Google LLC): leaf hashes, roots and proofs in base64 with a wantErr verdict.

Usage: python3 packages/ledger/scripts/fixtures/vectors.py
"""

import json
import pathlib
import urllib.request

FIXTURES = pathlib.Path(__file__).resolve().parents[2] / 'test' / 'fixtures'
JCS = 'https://raw.githubusercontent.com/cyberphone/json-canonicalization/master/testdata'
JCS_NAMES = ['arrays', 'french', 'structures', 'unicode', 'values', 'weird']
MERKLE_TREE = 'https://api.github.com/repos/transparency-dev/merkle/git/trees/main?recursive=1'
MERKLE_RAW = 'https://raw.githubusercontent.com/transparency-dev/merkle/main/'


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url) as response:
        return response.read()


def jcs() -> None:
    cases = []
    for name in JCS_NAMES:
        cases.append({
            'name': name,
            'input': fetch(f'{JCS}/input/{name}.json').decode('utf-8'),
            'output': fetch(f'{JCS}/output/{name}.json').decode('utf-8'),
        })
    out = {
        'source': 'https://github.com/cyberphone/json-canonicalization/tree/master/testdata',
        'license': 'Apache-2.0 (Copyright 2018 Anders Rundgren)',
        'cases': cases,
    }
    (FIXTURES / 'jcs-cyberphone.json').write_text(json.dumps(out, indent=2, ensure_ascii=False) + '\n')


def merkle() -> None:
    tree = json.loads(fetch(MERKLE_TREE))
    paths = sorted(
        entry['path'] for entry in tree['tree']
        if entry['type'] == 'blob' and entry['path'].endswith('.json')
        and (entry['path'].startswith('testdata/inclusion/')
             or entry['path'].startswith('testdata/consistency/'))
    )
    probes = []
    for path in paths:
        probe = json.loads(fetch(MERKLE_RAW + path))
        probe['file'] = path
        probes.append(probe)
    out = {
        'source': 'https://github.com/transparency-dev/merkle/tree/main/testdata',
        'license': 'Apache-2.0 (Copyright Google LLC)',
        'probes': probes,
    }
    (FIXTURES / 'merkle-probes.json').write_text(json.dumps(out, indent=2) + '\n')


if __name__ == '__main__':
    jcs()
    merkle()
    print(f'wrote {FIXTURES}/jcs-cyberphone.json and merkle-probes.json')
