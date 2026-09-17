# @mindpeeker/oracle

Bias-free mapping from entropy streams to archetypal systems: I-Ching,
Tarot, Elder Futhark runes, and Western geomancy.

Companion to [`@mindpeeker/entropy`](../entropy): where entropy *sources*
randomness, oracle *spends* it — turning raw bytes into readings whose
probabilities are exact rational numbers, with a receipt for every bit.

Zero dependencies, browser-safe (only `Math` and typed arrays), ESM. Every
`@mindpeeker/entropy` provider works as an input *structurally* — the
packages share a shape, not code:

```ts
interface ByteSource {
  readonly name: string
  stream(opts?: { signal?: AbortSignal; chunkBytes?: number }): AsyncIterable<Uint8Array>
}
```

The source side of that contract: honour `signal` (throwing *or* returning
on abort — both are reported as `aborted`), treat `chunkBytes` as a hint,
and release sockets/devices when the iterator's `return()` is called —
oracle calls it exactly once when it is done with a stream.

## Honest framing

Divination systems are cultural artifacts. This package makes **no** claim
about what a hexagram, card, rune, or figure *means* — meaning belongs to
the tradition and the reader. What it does guarantee is mathematical:

1. **Exactness** — every symbol is selected with its exact stated
   probability (rejection sampling, dyadic weights, Fisher–Yates), assuming
   the input bytes are uniform. There is no modulo bias, no floating-point
   threshold, no shuffle bias anywhere.
2. **Determinism** — the same input bytes always produce the exact same
   reading. Record the bytes and any reading is reproducible forever.
3. **Accounting** — every cast reports `{ bytesConsumed, bytesFetched,
   bitsUsed }`, so you can audit precisely how much entropy a reading spent
   and how much the source delivered.

Whether "quantum-sourced" readings are more meaningful than `Math.random()`
ones is a question this package deliberately does not answer.

## Quick start

```ts
import { byteReader, castHexagram, castRunes, castShield, castSpread } from '@mindpeeker/oracle'
import { cryptoProvider } from '@mindpeeker/entropy/providers' // or any ByteSource / Uint8Array

const src = cryptoProvider()

// One-off casts: each opens the source's stream, reads what it needs, and
// closes the stream again before it resolves (or throws, or is aborted).
const hex = await castHexagram(src, { method: 'yarrow' })
console.log(hex.primary.character, hex.primary.name.pinyin, '→', hex.relating?.name.pinyin)

const spread = await castSpread(src, 'celticCross', { reversals: true })
for (const { card, reversed, position } of spread.cards)
  console.log(position.name, card.name, reversed ? '(reversed)' : '')

// Several casts on ONE stream: share a reader (sequentially) and close it —
// `await using` does that at scope exit; or call `await reader.close()`.
{
  await using reader = byteReader(src)
  const runes = await castRunes(reader, 3, { merkstave: true })
  const shield = await castShield(reader)
  console.log(runes.runes.length, shield.judge.name, `(${shield.bitsUsed} bits)`)
}
```

Batch inputs work identically — `Uint8Array` (from any realm),
`ArrayLike<number>`, or any `AsyncIterable<Uint8Array>`. A finite input
that runs out mid-cast throws `OracleError('insufficient_entropy')`; every
cast accepts `{ signal }` for aborts — also on a shared reader — and
`{ chunkBytes }` (see [Lifecycle](#lifecycle-closing-sharing-aborting)).

## Probability models (exact fractions)

### I-Ching — `castHexagram(input, { method })`

Six lines bottom-up, each drawn as a 3- or 4-bit dyadic weighted index:

| line value | meaning | `coins` (3 bits) | `yarrow` (4 bits) |
|---|---|---|---|
| 6 | old yin (moving) | 1/8 | 1/16 |
| 7 | young yang | 3/8 | 5/16 |
| 8 | young yin | 3/8 | 7/16 |
| 9 | old yang (moving) | 1/8 | 3/16 |

Both methods give $P(\text{yang}) = 1/2$ exactly, so the *primary* hexagram
is uniform over all 64 — but the yarrow method moves yang lines three times
as often as yin lines, exactly as the traditional stalk procedure does
(Hacker, *The I Ching Handbook*, 1993). Moving lines invert to form the
*relating* hexagram. Consumption: exactly 18 bits (coins) or 24 bits
(yarrow), 3 bytes either way.

### Tarot — `castSpread(input, spread, { reversals })`

Uniform deal without replacement from the full 78-card RWS deck
(22 majors; Wands/Cups/Swords/Pentacles × Ace–King). Spreads: `single`,
`threeCard`, `celticCross` (10 positions), or any custom
`{ id, name, positions }` object. Each of the $78!/(78-m)!$ ordered deals
is exactly equiprobable; with `reversals`, each card flips with probability
exactly $1/2$ (one bit per card, drawn after all cards).

### Runes — `castRunes(input, count, { merkstave })`

Uniform draw without replacement from the historical 24-rune Elder Futhark
(no blank "Wyrd" rune — that is a 1980s invention). With `merkstave`, each
**invertible** rune flips with probability exactly $1/2$; the nine
point-symmetric runes (Gebo, Hagalaz, Nauthiz, Isa, Jera, Eihwaz, Sowilo,
Ingwaz, Dagaz — the standard non-reversible set, Thorsson 1984) have no
distinct upside-down state and consume no bit.

### Geomancy — `castShield(input)` and `houses(shield)`

16 MSB-first bits (2 bytes) form four Mothers of four rows each (Fire, Air,
Water, Earth; 1 = active/single point), uniform over all $2^{16}$ charts.
The rest is the classical derivation (Greer, *The Art and Practice of
Geomancy*, 2009): Daughters by transposition, then Nieces, Witnesses, and
Judge by row-wise geomantic addition, which with active $=1$ is exactly

$$r = a \oplus b$$

The Judge always lands on one of the eight even-point figures (each mother
bit enters the XOR pipeline exactly twice) — the classical validity check,
verified exhaustively over all 65 536 charts in this repo's tests, along
with a published worked example (Mothers Populus, Populus, Puella, Via →
Judge Conjunctio; The Digital Ambler, 2020). `houses(shield)` projects
Mothers → houses 1–4, Daughters → 5–8, Nieces → 9–12.

## Theory: why there is no bias

**Rejection sampling** (`uniformInt(reader, n)`). With
$k = \lceil \log_{256} n \rceil$ bytes per attempt, read a big-endian
$v \in [0, 256^k)$ and accept iff

$$v < \left\lfloor 256^k / n \right\rfloor \cdot n,$$

returning $v \bmod n$. The accepted prefix is an exact multiple of $n$, so
every residue is hit by exactly $\lfloor 256^k/n \rfloor$ values — *never
modulo without rejection* (the naive `v % n` over-weights small residues by
up to one part in $\lfloor 256^k/n\rfloor$). Acceptance probability
$\alpha > 1/2$ always, so expected consumption is $k/\alpha < 2k$ bytes;
consumption is unbounded only with exponentially vanishing probability.

**Dyadic weighted draws** (`weightedIndex(bits, weights)`). Distributions
whose probabilities are $w_i/2^k$ are realized by reading exactly $k$ bits
and comparing against integer cumulative sums — the flat case of the
Knuth–Yao generating tree (Knuth & Yao 1976), optimal for dyadic targets.
No floats, no rejection, exact by construction.

**Exact non-dyadic draws** (`weightedIndexRational(reader, weights)`). For
any non-negative integer weights with total $W \le 2^{48}$ (astragalus faces
$[1,4,4,1]/10$, 38-token models, …): draw $v$ = `uniformInt(reader, W)` and
return the smallest $i$ with $v < \sum_{j \le i} w_j$, so
$\Pr[i] = w_i/W$ exactly. It costs one `uniformInt(W)`: expected
$k/\alpha$ bytes with $k = \lceil \log_{256} W \rceil$ (see `expectedBytes`).

**Unbiased deals** (`drawWithoutReplacement(reader, n, count)`).
Fisher–Yates (Knuth, TAOCP vol. 2, Algorithm 3.4.2P) with every swap index
from `uniformInt` — the classic proof gives each ordered prefix probability
$\frac{(n-\texttt{count})!}{n!}$ exactly. (Tested exhaustively for $n = 3$:
all $65\,280$ two-byte streams, all 6 permutations exactly equiprobable.)
The shuffle is sparse — a map of displaced slots stands in for the identity
array — so memory is $O(\texttt{count})$ for any $n \le 2^{32}$, with the
identical swap sequence and byte consumption of the textbook in-place
version (tested against it over 600 seeded runs).

**Bit order** is MSB-first SDK-wide.

## Entropy accounting

Every cast result includes:

- `bytesConsumed` — bytes the cast read from its reader, *including* bytes
  discarded by rejection and buffered bits never handed out. This is
  exactly what a replay needs.
- `bytesFetched` — bytes the reader pulled out of the underlying input
  during the cast, including the unread rest of the last chunk: for a live
  source, what it actually delivered (and what a metered QRNG bills).
  Equal to `bytesConsumed` for batches; on a shared reader it can be
  smaller (bytes already buffered by an earlier cast). Absent only for
  custom readers that do not track it.
- `bitsUsed` — bits that actually entered decisions ($8k$ per byte-level
  draw, exact counts for bit-level draws).

Invariant: `bitsUsed ≤ 8 × bytesConsumed`. Fixed costs: hexagram 18/24
bits, shield 16 bits; deals cost ~$8\lceil\log_{256} n\rceil$ bits per card
plus rejection overhead — `expectedBytes(spread, { reversals })` gives the
exact expectation:

$$E[\text{bytes}] = \sum_{i=0}^{c-1} \frac{k_{n-i}}{\alpha_{n-i}}
  + [\text{reversals}] \left\lceil \tfrac{c}{8} \right\rceil,\quad
  k_m = \lceil \log_{256} m \rceil,\;
  \alpha_m = \frac{\lfloor 256^{k_m}/m \rfloor\, m}{256^{k_m}}$$

(the $m = 1$ term is 0). A Celtic Cross with reversals expects ≈ 13.63
bytes; `expectedBytes({ n, count, reversals })` covers any deal and
`{ n: W, count: 1 }` one `uniformInt(W)`.

**`chunkBytes`.** A cast that opens a `ByteSource` asks for
`stream({ signal, chunkBytes: 32 })` by default (override per cast with
`{ chunkBytes }`), so a 3-byte hexagram does not pull a provider's
1024-byte default chunk. It is a hint: providers may round or ignore it —
`bytesFetched` shows what actually arrived. `byteReader(src)` without
`chunkBytes` leaves the provider's default in place.

## Lifecycle: closing, sharing, aborting

- **Casts close what they open.** Given a `ByteSource`, an
  `AsyncIterable`, or a batch, a cast creates a reader and closes it before
  its promise settles — on success, error, or abort. For a stream that
  means the iterator's `return()` is called exactly once, so a provider's
  `finally` (WebSocket, serial port, camera track) runs. An `AsyncIterable`
  is consumed like `for await`: after the cast it is finished.
- **A reader you pass in stays open.** `byteReader(input)` gives you a
  `ByteReader` you own: close it with `await reader.close()` or declare it
  with `await using`. `close()` is idempotent, never rejects, waits at most
  250 ms for the source's `return()` (errors ignored; if a pull is still in
  flight it does not wait at all), and makes a pending `next()` reject with
  `closed`. Reading after `close()` throws `OracleError('closed')`.
- **Shared readers are sequential.** Casts on one reader must run one after
  the other (that is what makes per-cast deltas and replays meaningful). A
  second cast started on a reader another cast is still using — or a
  `next()` while another `next()` is pending — throws
  `OracleError('invalid_input', 'reader is already in use …')`.
- **Aborts work on shared readers too.** `castX(reader, { signal })` (or
  `byteReader(reader, { signal })`) reads through an abortable view:
  aborting rejects the cast with `aborted` immediately — also when the
  signal was already aborted — while the shared reader stays open. A chunk
  that was still being fetched is kept and handed to the next read, so no
  bytes are lost. Closing a view never closes the reader beneath it.
- **Replay.** `recordingReader(input)` returns `{ reader, bytes() }`; every
  byte consumed through `reader` is captured, so
  `castSpread(rec.bytes(), …)` reproduces a live reading exactly. Its
  `reader` is yours to close (it closes the stream it opened, never a
  shared reader it wraps).

Code that creates readers itself (e.g. a package composing oracle) can
follow one rule: close the reader iff `reader !== input`.

## API

Core (composable, exported for building your own systems):

- `byteReader(input, { signal?, chunkBytes? })` → `ByteReader` — adapt
  `Uint8Array | ArrayLike<number> | AsyncIterable<Uint8Array> | ByteSource`;
  an existing reader is returned unchanged (or wrapped in an abortable view
  when `signal` is given), so casts can share one stream and report
  per-cast deltas. `ByteReader` = `{ bytesConsumed, bytesFetched?, next(),
  close(), [Symbol.asyncDispose]() }`
- `recordingReader(input, { signal?, chunkBytes? })` → `{ reader, bytes() }`
- `bitReader(reader)` → `BitReader` — MSB-first `nextBit()` / `nextBits(k ≤ 48)`
- `uniformInt(reader, n)` — rejection-sampled uniform on $[0, n)$, $n \le 2^{48}$
- `weightedIndex(bits, weights)` — exact dyadic categorical draw
- `weightedIndexRational(reader, weights)` — exact categorical draw for any
  integer weights
- `drawWithoutReplacement(reader, n, count)` — unbiased permutation prefix,
  $O(\texttt{count})$ memory
- `expectedBytes(spread | spreadName | { n, count, reversals? }, { reversals? })`
  — expected consumption of a deal
- `DEFAULT_CAST_CHUNK_BYTES` (32), type `CastReaderOptions` (`signal`,
  `chunkBytes`) shared by every cast's options

Systems:

- `castHexagram(input, { method?, signal?, chunkBytes? })`, data:
  `HEXAGRAMS` (64), `TRIGRAMS` (8), `hexagramFromBinary(bits)`
- `castSpread(input, spreadOrName?, { reversals?, signal?, chunkBytes? })`,
  data: `TAROT_DECK` (78), `SPREADS`
- `castRunes(input, count, { merkstave?, signal?, chunkBytes? })`, data:
  `ELDER_FUTHARK` (24)
- `castShield(input, { signal?, chunkBytes? })`, `houses(shield)`, data:
  `GEOMANTIC_FIGURES` (16), `figureFromBinary(bits)`

All data tables are deeply `Object.freeze`d, and so is every cast result —
a custom spread object is stored as a frozen copy. The types use
`Symbol.asyncDispose` (TypeScript ≥ 5.2; the declarations reference the
`esnext.disposable` lib). At runtime the method is keyed by
`Symbol.asyncDispose`, or `Symbol.for('Symbol.asyncDispose')` where the
runtime predates it.

## Errors

Every error this package throws is an `OracleError` with a stable `code`
(`message` is free to change):

| code | when |
|---|---|
| `insufficient_entropy` | a finite input ran out before the cast completed |
| `invalid_spread` | unknown spread name (inherited keys like `'constructor'` included), or a malformed / empty / >78-position spread object |
| `invalid_input` | caller error: bad `n`/`count`/weights/options (unknown `method`, non-boolean `reversals`/`merkstave`, bad `chunkBytes`/`signal`, `null` options), non-byte values, unrecognized input shape, a reader already in use |
| `aborted` | an AbortSignal governing the read fired (also when the source then throws its own abort error or simply ends) |
| `source_error` | the input itself failed — a provider's network error, a throwing generator, a failing custom reader; the original error is `cause`, the provider name `source`. An `OracleError` thrown by a source passes through unchanged |
| `closed` | a read on a reader after `close()`, or a pending read cut short by `close()` |

## Behaviour changes in 0.2.0

- `ByteReader` gained `close()` and `[Symbol.asyncDispose]()` (and the
  optional `bytesFetched`): custom implementations of the interface must add
  them. Objects with just `next()` + `bytesConsumed` are still accepted as
  inputs.
- Casts close the reader they create. An `AsyncIterable` (e.g. a generator
  object) passed directly to a cast is finished afterwards; to continue one
  stream across casts, share `byteReader(iterable)` instead.
- Source failures are wrapped as `source_error` instead of propagating raw.
- A per-cast `signal` now aborts casts on a shared reader (it was ignored).
- Concurrent casts on one reader, and concurrent `next()` calls on a stream
  reader, throw `invalid_input` instead of silently interleaving bytes.
- Casts request `chunkBytes: 32` from a `ByteSource` they open.
- Stricter validation: inherited method/spread names, `null`/malformed
  spreads, non-boolean `reversals`/`merkstave`, `method: null`, `null`
  options, invalid `signal`/`chunkBytes` now throw typed errors.
- `cast.spread` for a custom spread is a frozen copy, not the caller's object.
- A rejected invalid byte in a batch no longer counts toward `bytesConsumed`.
- A `ByteSource` that is also async-iterable is read through `stream()`.
- `drawWithoutReplacement` no longer allocates $O(n)$ (same outputs);
  $n = 2^{32}$ works instead of throwing a raw `RangeError`.

## Frontend compatibility notes

Shapes were aligned with the mindpeeker frontend
(`scripts/generate-*.ts`, `server/utils/oracleCast.ts`) where cheap:

- **I-Ching**: `binary` is bottom→top yang=1 (their `hexagrams.json` key);
  `CastLine { position, value, yang, changing }` matches theirs.
- **Tarot**: card ids `m00…m21`, `w/c/s/p01…14` match their `tarot.json`;
  Celtic Cross position names match their spread data.
- **Runes**: lowercase ids match; deliberate divergences — 24 runes (no
  blank Wyrd), and Nauthiz is *non-invertible* here (its glyph is
  point-symmetric; the frontend treats it as reversible).
- **Geomancy**: figure ids and Fire→Earth `binary` keys match; the chart
  shape (mothers/daughters/nieces/witnesses/judge) matches, carrying full
  figure objects instead of bare strings.
- **Deliberate divergence**: the frontend's `nextInt` is modulo-biased and
  recycles bytes; this package rejects instead — same systems, not
  bit-compatible streams.

## Caveats

- Uniform in ⇒ unbiased out. Feed biased bytes and the guarantee is void —
  condition first (e.g. `@mindpeeker/negentropy`'s extractors).
- Elemental/planetary attributions in the geomancy table follow one
  tradition (Golden Dawn zodiacal elements; Agrippa planets). Sources
  disagree; treat them as data, not doctrine.
- `uniformInt` consumption is unbounded in the worst case (geometric tail).
  With finite inputs, size generously: a Celtic Cross with reversals needs
  `expectedBytes('celticCross', { reversals: true })` ≈ 13.63 bytes on
  average but can need more.
- No cryptographic claims: this package maps entropy, it does not make it.
