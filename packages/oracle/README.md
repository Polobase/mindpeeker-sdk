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
3. **Accounting** — every cast reports `{ bytesConsumed, bitsUsed }`, so
   you can audit precisely how much entropy a reading spent.

Whether "quantum-sourced" readings are more meaningful than `Math.random()`
ones is a question this package deliberately does not answer.

## Quick start

```ts
import { castHexagram, castSpread, castRunes, castShield } from '@mindpeeker/oracle'
import { cryptoProvider } from '@mindpeeker/entropy' // or any ByteSource / Uint8Array

const src = cryptoProvider()

const hex = await castHexagram(src, { method: 'yarrow' })
console.log(hex.primary.character, hex.primary.name.pinyin, '→', hex.relating?.name.pinyin)

const spread = await castSpread(src, 'celticCross', { reversals: true })
for (const { card, reversed, position } of spread.cards)
  console.log(position.name, card.name, reversed ? '(reversed)' : '')

const runes = await castRunes(src, 3, { merkstave: true })
const shield = await castShield(src)
console.log(shield.judge.name, `(${shield.bitsUsed} bits)`)
```

Batch inputs work identically — `Uint8Array`, `ArrayLike<number>`, or any
`AsyncIterable<Uint8Array>`. A finite input that runs out mid-cast throws
`OracleError('insufficient_entropy')`; every cast accepts
`{ signal }` for aborts.

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

**Unbiased deals** (`drawWithoutReplacement(reader, n, count)`).
Fisher–Yates (Knuth, TAOCP vol. 2, Algorithm 3.4.2P) with every swap index
from `uniformInt` — the classic proof gives each ordered prefix probability
$\frac{(n-\texttt{count})!}{n!}$ exactly. (Tested exhaustively for $n = 3$:
all $65\,280$ two-byte streams, all 6 permutations exactly equiprobable.)

**Bit order** is MSB-first SDK-wide.

## Entropy accounting

Every cast result includes:

- `bytesConsumed` — raw bytes pulled from the input, *including* bytes
  discarded by rejection and buffered bits never handed out;
- `bitsUsed` — bits that actually entered decisions ($8k$ per byte-level
  draw, exact counts for bit-level draws).

Invariant: `bitsUsed ≤ 8 × bytesConsumed`. Fixed costs: hexagram 18/24
bits, shield 16 bits; deals cost ~$8\lceil\log_{256} n\rceil$ bits per card
plus rejection overhead.

## API

Core (composable, exported for building your own systems):

- `byteReader(input, { signal? })` → `ByteReader` — adapt
  `Uint8Array | ArrayLike<number> | AsyncIterable<Uint8Array> | ByteSource`;
  idempotent on an existing reader, so casts can share one stream and
  report per-cast deltas
- `bitReader(reader)` → `BitReader` — MSB-first `nextBit()` / `nextBits(k ≤ 48)`
- `uniformInt(reader, n)` — rejection-sampled uniform on $[0, n)$, $n \le 2^{48}$
- `weightedIndex(bits, weights)` — exact dyadic categorical draw
- `drawWithoutReplacement(reader, n, count)` — unbiased permutation prefix

Systems:

- `castHexagram(input, { method?, signal? })`, data: `HEXAGRAMS` (64),
  `TRIGRAMS` (8), `hexagramFromBinary(bits)`
- `castSpread(input, spreadOrName?, { reversals?, signal? })`, data:
  `TAROT_DECK` (78), `SPREADS`
- `castRunes(input, count, { merkstave?, signal? })`, data: `ELDER_FUTHARK` (24)
- `castShield(input, { signal? })`, `houses(shield)`, data:
  `GEOMANTIC_FIGURES` (16), `figureFromBinary(bits)`

All data tables are deeply `Object.freeze`d. Errors are always
`OracleError` with `code ∈ { insufficient_entropy, invalid_spread,
invalid_input, aborted }`.

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
  ~12–14 bytes on average but can need more.
- No cryptographic claims: this package maps entropy, it does not make it.
