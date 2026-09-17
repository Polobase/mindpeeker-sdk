# @mindpeeker/ledger

Tamper-evident experiment records built from standard, checkable cryptography:
RFC 8785 canonical JSON, hash-chained JSONL, RFC 6962 Merkle trees with inclusion
and consistency proofs, C2SP signed-note checkpoints with Ed25519, Blum
commit–reveal, a pre-registration schema, and a beacon/VDF time-bracket record.

A ledger proves **what** was written and, with published anchors, **roughly when** —
never that a hypothesis is true, that the data came from where it claims, or that
the experimenter behaved well outside the record. Every primitive here is exact,
specified byte for byte, and verifiable by third parties with any conforming
implementation (the tests check them against RFC worked examples, published test
vectors and independent Python computations). What each one does *not* prove is
listed next to it below; read that table before relying on any of them.

Zero dependencies, browser-safe (`crypto.subtle` only — SHA-256 and Ed25519),
ESM, no network code: fetching beacons, publishing heads and timestamping are the
caller's, so the trust in each outside party stays visible.

## Install

```sh
npm install @mindpeeker/ledger    # or bun add @mindpeeker/ledger
```

## Quick start

```ts
import {
  appendEntry,
  checkpointOf,
  merkleTree,
  registrationHash,
  startChain,
  verifyChain,
  verifyInclusion,
} from '@mindpeeker/ledger'

// 1. Freeze the plan. The hash is what you publish (OSF, KPU registry, a signed checkpoint).
const registration = {
  title: 'Tripolar REG replication',
  hypotheses: [
    {
      id: 'H1',
      statement: 'HI-LO separation exceeds chance',
      kind: 'confirmatory' as const,
      statistic: 'deltaZ = (zHI - zLO) / sqrt(2)',
      null: 'N(0, 1)',
      direction: 'greater' as const,
    },
  ],
  primary: 'H1',
  alpha: 0.05,
  sample: { kind: 'fixed' as const, size: 3000, unit: 'trials' },
  analysisPlanHash: '9f2c0e7d3a1b5c4e8f6a0b2d4c6e8a0b1c3d5e7f9a2b4c6d8e0f1a3b5c7d9e1f',
  exclusions: ['runs aborted by a source health failure'],
  dataSources: [{ name: 'truerng-3', role: 'experimental' as const }],
}
const genesis = await registrationHash(registration)

// 2. Log records into a chain bound to the registration.
let chain = startChain(genesis)
const lines: string[] = []
for (const record of [{ run: 0, sum: 1012 }, { run: 1, sum: 987 }]) {
  const appended = await appendEntry(chain, record)
  lines.push(appended.line) // persist line + '\n' anywhere
  chain = appended.chain
}

// 3. Anyone re-verifies the file; publish chain.head so truncation is detectable too.
const check = await verifyChain(lines, { genesis, head: chain.head }) // { ok: true, head, … }

// 4. Merkle view of the same lines: a checkpoint to sign, O(log n) proofs per line.
const checkpoint = await checkpointOf('example.org/tripolar-log', lines)
const tree = await merkleTree(lines)
await verifyInclusion(lines[1] ?? '', 1, tree.size, tree.inclusionProof(1), checkpoint.root) // true
```

## What each primitive proves — and what it does not

| primitive | proves | does **not** prove |
|---|---|---|
| canonical JSON + SHA-256 (`canonicalize`, `registrationHash`) | two parties hashed the same structured content | when it was written, or that it was followed |
| hash chain (`appendEntry`, `verifyChain`) | lines were not edited, inserted, deleted or reordered **relative to the head you compare against** | anything about truncation at the end unless a head was published or timestamped earlier; anything about the time of writing; that a whole chain was not fabricated in one go |
| Merkle tree (`merkleRoot`, `verifyInclusion`, `verifyConsistency`) | a line is in the tree with that root; a later tree extends an earlier one (append-only) | that the root was published when claimed; a proof alone does not authenticate the tree size — take `(size, root)` from a signed checkpoint |
| signed checkpoint (`verifyCheckpoint`) | the key holder signed this `(origin, size, root)` | that the key holder is honest or did not sign a fork — collect checkpoints over time and check consistency (witnesses) |
| commit–reveal (`commit`, `combineReveals`) | nobody could choose their value after seeing another's; one honest uniform share makes the XOR uniform | fairness against a **last revealer who aborts** (see below); secrecy if the nonce is weak |
| beacon anchor (`TimeBracket.notBefore`) | the record was completed **no earlier** than the beacon round's publication — if the value is genuine (fetch it yourself) and was unpredictable | anything about *no later than* |
| VDF seal (`TimeBracket.seal`) | ≈ T sequential squarings were spent after the seal input was fixed: another **no-earlier-than** bound | an upper bound on time; the wall-clock meaning depends on the fastest hardware anyone owns |
| no-later-than witness (`TimeBracket.notAfter`) | an outside party (Bitcoin via OpenTimestamps, Rekor, a transparency-log checkpoint, a later beacon that committed to the hash) saw the hash by its time | anything beyond that witness's own trust model; this package stores the reference and runs your verifier hook, it has no network code |

A self-hosted chain is not an independent registry: publish the registration hash
and chain heads where you cannot rewrite them.

## API

### Canonical JSON and hashing

| export | what it does |
|---|---|
| `canonicalize(value)` | RFC 8785 JCS string: UTF-16 key order, ECMAScript number form, no whitespace; rejects NaN/±∞, `undefined`, holes, BigInt, Map/Set/Date/typed arrays/class instances, lone surrogates, noncharacters, cycles, nesting > `MAX_JSON_DEPTH` (512) |
| `canonicalBytes(value)` | UTF-8 bytes of the above |
| `sha256(data)` / `sha256Hex(data)` | WebCrypto SHA-256; strings hash as UTF-8 |
| `toHex` / `fromHex` / `isHashHex` / `ZERO_HASH` | hex helpers; `ZERO_HASH` = 64 zeros |

`canonicalize` is byte-identical to `canonicalJson` in `@mindpeeker/negentropy` for
every value both accept (checked by a seeded cross-package test).

### Hash chains

| export | what it does |
|---|---|
| `startChain(genesis?)` | `{ genesis, head: genesis, size: 0 }` (default genesis `ZERO_HASH`) |
| `appendEntry(chain, record)` | → `{ line, entry, chain }`; `line = canonicalize({ i, prev, record })`, new `head = SHA-256(line)` |
| `parseEntry(line)` | strict parse of one ledger line (exact members, canonical form) |
| `verifyChain(lines, { format?, genesis?, head? })` | → `{ ok, lines, entries, head?, chain?, brokenAt?, failure?, reason? }`; never throws for content problems |

`format`: `'ledger'` (canonical entries only), `'psi'` (psi schema-v2 recordings),
`'auto'` (default: an optional unlinked header line, then linked lines). Name the
format you expect: `'auto'` accepts either layout, so it cannot tell a ledger chain
whose first entry was swapped for a header-like line from a psi recording (the next
line's `prev` still breaks unless every later line was rewritten too — which only a
published `head` exposes). `failure` is
one of `empty`, `not_json`, `not_object`, `not_canonical`, `bad_record`, `bad_header`,
`missing_link`, `bad_index`, `bad_prev`, `head_mismatch`. Input is a JSONL string or an
(async) iterable of strings holding whole lines; a trailing `\r` is dropped and blank
lines are skipped.

### Merkle trees (RFC 6962 §2.1)

| export | what it does |
|---|---|
| `leafHash(data)` / `nodeHash(left, right)` | $\mathrm{SHA\text{-}256}(\mathtt{0x00} \,\|\, d)$ / $\mathrm{SHA\text{-}256}(\mathtt{0x01} \,\|\, L \,\|\, R)$ |
| `merkleRoot(leaves)` | MTH; the empty tree hashes to SHA-256 of the empty string |
| `merkleTree(leaves)` | cached tree `{ size, root, leafHash(i), inclusionProof(i), consistencyProof(m) }` for many proofs |
| `inclusionProof(leaves, index)` / `consistencyProof(leaves, m)` | PATH(index, Dₙ) / PROOF(m, Dₙ), `1 ≤ m ≤ n` |
| `verifyInclusion(leaf, index, size, proof, root)` / `verifyInclusionHash(leafHash, …)` | RFC 9162 §2.1.3.2 → `boolean` |
| `verifyConsistency(m, n, rootM, rootN, proof)` | RFC 9162 §2.1.4.2 → `boolean`; `m = 0` and `m > n` are false, `m = n` needs an empty proof and equal roots |

Leaves are bytes or strings (UTF-8), so a JSONL line is a leaf as-is. Verifiers
return `false` for any proof that does not check out and throw only for malformed
arguments (non-integer sizes, non-byte values). Sizes are safe integers (< 2⁵³).

### Signed notes and checkpoints (C2SP)

| export | what it does |
|---|---|
| `parseSignedNote(text)` / `serializeSignedNote(note)` | text up to the last blank line + `— <name> base64(keyId ‖ sig)` lines |
| `parseVerifierKey(vkey)` / `ed25519VerifierKey(name, publicKey)` | `<name>+<hex id>+base64(type ‖ key)`; Ed25519 key IDs are checked |
| `noteKeyId(name, type, publicKey)` | first 4 bytes of SHA-256(name ‖ 0x0A ‖ type ‖ key) |
| `signNote(text, { name, privateKey, publicKey })` | Ed25519 signature via WebCrypto |
| `verifyNote(note, keys, { subtle? })` | → `{ status: 'verified' \| 'failed' \| 'unverified', verified, failed, unknown, unsupported, reason? }` |
| `parseCheckpoint(text)` / `serializeCheckpoint(cp, signatures?)` / `checkpointText(cp)` | origin, decimal size (no leading zeros), base64 32-byte root, extension lines |
| `checkpointOf(origin, leaves)` | the checkpoint body of a leaf list |
| `verifyCheckpoint(text, keys, { origin?, subtle? })` | parse + `verifyNote`; unparseable text is `failed`, not thrown |

Verification follows the spec: signatures from unknown keys are ignored, every
signature from a known key must verify, at least one must. Only Ed25519 (type
`0x01`) is verified; other key types and runtimes whose WebCrypto lacks Ed25519
yield `unverified` with the signatures listed under `unsupported` — never a false
`verified`.

### Commit–reveal (Blum)

| export | what it does |
|---|---|
| `commit(value, nonce)` | $\mathrm{SHA\text{-}256}(\texttt{"mindpeeker-ledger-commit"} \,\|\, \mathrm{LP}(v) \,\|\, \mathrm{LP}(r))$, $\mathrm{LP}(x) = \mathrm{u64be}(\lvert x\rvert) \,\|\, x$; nonce ≥ 16 bytes |
| `openCommitment(commitment, value, nonce)` | `boolean` |
| `combineReveals(values, beacon?)` | XOR of equal-length reveals; with a beacon $\mathrm{SHA\text{-}256}(\texttt{"mindpeeker-ledger-combine"} \,\|\, \mathrm{LP}(\oplus v_i) \,\|\, \mathrm{LP}(b))$ |
| `COMMIT_DOMAIN`, `COMBINE_DOMAIN`, `MIN_NONCE_BYTES` | constants |

Protocol: every party commits before a deadline, then all reveal; the seed is
`combineReveals(reveals, beaconValue)`. **Last-revealer abort:** whoever opens last
already knows the outcome and can refuse to open, forcing a restart — a bias that
XOR cannot remove. Record every missing reveal as a protocol failure (never retry
silently) and remove the advantage by fixing a **future beacon round** in the
registration whose value is published only after the reveal deadline; then no
revealer can compute the outcome in time. A VDF seal over the reveals has the same
effect without a beacon. Draw nonces with `crypto.getRandomValues(new Uint8Array(32))`.

### Registration schema

| export | what it does |
|---|---|
| `validateRegistration(value)` | deeply frozen, normalized `Registration`; unknown fields rejected |
| `registrationCanonical(reg)` | canonical JSON of `{ schema: REGISTRATION_SCHEMA, registration }` — publish it next to the hash |
| `registrationHash(reg)` | SHA-256 hex of the above |

Fields, modelled on the Koestler Parapsychology Unit registry: `title`, `authors?`,
`hypotheses[]` (`id`, `statement`, `kind: 'confirmatory' | 'exploratory'`, and for
confirmatory ones `statistic`, `null`, `direction`), `primary` (a confirmatory id),
`alpha` ∈ (0, 1), `correction` (required with more than one confirmatory hypothesis),
`sample` (`{ kind: 'fixed', size, unit }` or `{ kind: 'sequential', rule, minSize?,
maxSize, unit, planHash? }`), `analysisPlanHash`, `exclusions[]` (empty = none),
`dataSources[]` (`name`, `description?`, `role?: 'experimental' | 'control'`),
`blinding?`, `supersedes?` (hash of the revised registration), `notes?`. Validation is
structural: a valid registration can still be underpowered or test the wrong thing.

### Time brackets

| export | what it does |
|---|---|
| `validateTimeBracket(value)` | structure of `{ registrationHash, notBefore: { beacon }, seal?, notAfter? }` |
| `timeBracketSealInput(bracket)` | bytes to seal: canonical `{ schema, registrationHash, notBefore }` |
| `timeBracketHash(bracket)` | SHA-256 hex of canonical `{ schema: TIME_BRACKET_SCHEMA, bracket }` |
| `verifyTimeBracket(bracket, opts?)` | → `{ ok, structure, registration, beacon, seal, notAfter, notBeforeTime?, issues }` |

`beacon` is `{ source, chain, round, timestamp (ISO 8601 UTC), valueHex }`; `seal` is
`{ kind: 'vdf-pietrzak', bytesHex }` (the `@mindpeeker/vdf` `sealToBytes` format);
`notAfter` is `{ kind: 'ots' | 'rekor' | 'tlog-checkpoint' | 'beacon', ref }` with an
opaque reference. Options: `registrationHash`, `minRound`, `beacon` (fields you fetched
yourself, compared one by one), `verifySeal` (pass vdf's `verifySealBytes`),
`verifyNotAfter`, `requireSeal`, `requireNotAfter`. Without a hook, present evidence is
reported `unverified`, never `verified`.

```ts
import { verifyTimeBracket, timeBracketSealInput, toHex, type TimeBracket } from '@mindpeeker/ledger'
import { sealBeacon, sealToBytes, verifySealBytes } from '@mindpeeker/vdf'
import { DRAND_CHAINS, drand } from '@mindpeeker/entropy/providers'

declare const registrationHash: string // from registrationHash(registration), fixed beforehand
const pulse = await drand().getRound(23_456_789) // a round published after the plan was frozen
const bracket: TimeBracket = {
  registrationHash,
  notBefore: {
    beacon: {
      source: 'drand',
      chain: DRAND_CHAINS.quicknet.hash,
      round: pulse.round.round,
      timestamp: new Date(pulse.round.timestamp ?? 0).toISOString(),
      valueHex: toHex(pulse.bytes),
    },
  },
}
const input = timeBracketSealInput(bracket)
const sealed = { ...bracket, seal: { kind: 'vdf-pietrzak' as const, bytesHex: toHex(sealToBytes(await sealBeacon(input, 1_000_000), input)) } }

// A verifier fetches the round independently and checks everything offline:
const replay = await drand().getRound(sealed.notBefore.beacon.round)
await verifyTimeBracket(sealed, {
  registrationHash,
  beacon: { valueHex: toHex(replay.bytes) },
  verifySeal: verifySealBytes,
  requireSeal: true,
}) // { ok: true, seal: 'verified', notAfter: 'absent', … }
```

The bracket above still has no upper bound: add a `notAfter` witness (for example the
OpenTimestamps proof of `timeBracketHash(sealed)`), verified with your own hook.

## Formats (normative)

- **Ledger chain line**: `canonicalize({ i, prev, record })` — members `i`, `prev`,
  `record` in that (sorted) order, no trailing newline in the hashed text. `i` counts
  from 0; `prev` of entry 0 is the genesis; `prev` of entry i > 0 and the chain head
  are lower-case hex SHA-256 of the previous line's UTF-8 bytes.
- **psi JSONL schema v2** (written by `@mindpeeker/psi` `recordSession(sources, { chain })`):
  line 0 is the header
  `{"v":2,"kind":"session","sources":[…],"bitsPerTrial":…,"registration":…,"genesis":…}`
  (`registration` optional; `genesis` = registration hash or 64 zeros); every later line
  is `{"v":2,"i":…,"prev":…,"t":…,"source":…,"sum":…,"bitsPerTrial":…,"arm"?,"segment"?,"run"?}`
  in that fixed (not sorted) key order, `i` from 0, `prev` = SHA-256 of the previous
  line's exact text (the header for `i = 0`). `verifyChain(lines, { format: 'psi' })`
  checks the header structure and every link and returns the same `head` as psi's own
  `verifyChain`; psi's field validation (sums, sources, bit counts) stays in psi.
- **Merkle**: RFC 6962 §2.1 with SHA-256; leaf and node prefixes `0x00`/`0x01`.
- **Checkpoint / signed note**: c2sp.org/tlog-checkpoint and c2sp.org/signed-note;
  Ed25519 signature type `0x01` over the note text including its final newline.
- **Commitment**: preimage `"mindpeeker-ledger-commit"` (UTF-8, unprefixed) ‖
  u64be(len v) ‖ v ‖ u64be(len r) ‖ r.
- **Registration hash**: SHA-256 of `canonicalize({ schema: "mindpeeker-ledger/registration/1", registration })`.
- **Time bracket**: seal input `canonicalize({ schema: "mindpeeker-ledger/time-bracket-seal/1",
  registrationHash, notBefore })`; bracket hash over `{ schema: "mindpeeker-ledger/time-bracket/1", bracket }`.

## Errors

Every throw is a `LedgerError` with a stable `code`: `invalid_json`, `invalid_input`,
`invalid_entry`, `invalid_registration`, `invalid_bracket`, `invalid_note`,
`crypto_unavailable`. Verification functions (`verifyChain`, `verifyInclusion`,
`verifyConsistency`, `verifyCheckpoint`, `verifyTimeBracket`) report content problems
in their results and throw only for caller errors; `verifyNote` additionally throws
`invalid_note` for text that is not a signed note at all (`verifyCheckpoint` reports
that as `failed`).

## Test vectors and sources

- RFC 8785 §3.2.2–3.2.4 worked example and Appendix B number table; the six
  `cyberphone/json-canonicalization` reference files named in RFC 8785 Appendix I
  (Apache-2.0).
- RFC 6962 / RFC 9162 §2.1: roots, every inclusion and consistency proof for sizes 1–16
  and digests over all proofs for sizes 17–64 from an independent Python implementation of
  the RFC recursions (`scripts/fixtures/merkle.py`, hashlib); the reference roots of
  `transparency-dev/merkle`; its 196 inclusion/consistency verification probes
  (Apache-2.0, `scripts/fixtures/vectors.py`); the RFC 9162 §2.1.5 example tree.
- Signed notes: the `golang.org/x/mod/sumdb/note` test keys and signatures (BSD-3-Clause),
  the c2sp.org/signed-note example, and a live `sum.golang.org` checkpoint captured
  2026-09-17 — all verified independently with `pyca/cryptography`
  (`scripts/fixtures/notes.py`).
- Commitments, chains, registration and bracket hashes: Python hashlib known answers
  (`scripts/fixtures/records.py`).
- psi interop: a recording written by `@mindpeeker/psi` itself
  (`scripts/fixtures/psi-recording.ts`), with its head recomputed in Python; tests
  import psi and vdf only through the workspace test configuration — neither is a
  dependency.
- Background: Schneier & Kelsey (1999) and Crosby & Wallach (2009) on tamper-evident
  logs; Blum (1983) coin flipping by telephone; NIST IR 8213 §7.2 (commit upfront, derive
  the seed from a later pulse); the KPU study registry; the Transparent Psi Project
  (Kekecs et al. 2023) and its published correction, which reports that procedural
  tamper-evidence (repository syncing, server logs) silently failed.

## Behaviour changes in 0.2.0

New package in 0.2.0 — no earlier behaviour to change.
