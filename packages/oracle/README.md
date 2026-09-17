# @mindpeeker/oracle

Bias-free mapping from entropy streams to archetypal systems: I-Ching,
Tarot, runes (Elder and Younger Futhark, Anglo-Saxon futhorc), Western
geomancy, Ifá and sixteen cowries, Chinese fortune sticks, Tibetan Mo,
astragaloi, and the Homer oracle.

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

## Systems catalogue

Every probability below is exact *given uniform input bytes*. "Modeled"
means the physical procedure is idealized (fair coins, shells, blocks, dice,
a perfect shuffle); the stated distribution is the null a pre-registered
study can use, not a measurement of real objects.

| System | Cast | Sample space | Exact probabilities | Consumption | Primary source | Status |
|---|---|---|---|---|---|---|
| I Ching, coins | `castHexagram(src)` | $4^6$ line sequences | lines 6/7/8/9: 1/8, 3/8, 3/8, 1/8 | 18 bits | H. Wilhelm (1957): 1:3:3:1 of 8 | modeled |
| I Ching, yarrow | `{ method: 'yarrow' }` | $4^6$ | 1/16, 5/16, 7/16, 3/16 | 24 bits | Legge (1899), Great Appendix I.9; H. Wilhelm: 4:20:28:12 of 64 | modeled |
| I Ching, one moving line | `{ method: 'singleLine' }` | $64 \cdot 6 = 384$ | 1/384 each | 6 bits + `uniformInt(6)` | Crowley, *Liber CCXVI* | modeled |
| Tarot | `castSpread(src, spread, opts)` | $N!/(N-m)!$, $N$ = 78 or 77 | uniform deal; reversed $r/(r+u)$ | `expectedBytes(spread, opts)` | Waite, *Pictorial Key* (1911) | modeled shuffle |
| Runes | `castRunes(src, count \| 'norns', opts)` | $n!/(n-c)!$, $n$ ∈ {24, 16, 28, 29, 33} (+1 blank) | uniform; merkstave 1/2 (Elder) | ≈1 byte/rune (+1 bit merkstave) | Gundarsson (1990); Dickins (1915); Blum (1982, blank) | modeled draw |
| Rune sets | `castRuneSets(src, [3, 3, 1])` | $\prod_j n!/(n-s_j)!$ | independent sets | sum of the sets | Arcarti (1993) | modeled draw |
| Geomancy | `castShield(src)` | $2^{16}$ charts | 1/65 536 | 16 bits | Crowley, *Liber XCVI* (1909); Skinner (1980) | modeled |
| Ifá | `castOdu(src, { method })` | 256 odu | 1/256 | 8 bits | Bascom, *Ifa Divination* (1969) | modeled (chain: "equal (1 in 256)", Bascom) |
| Sixteen cowries | `castCowries(src)` | 17 counts ($2^{16}$ patterns) | $\binom{16}{k}/2^{16}$ | 16 bits | Bascom, *Sixteen Cowries* (1980) | modeled |
| Kau cim | `castLot(src, { sticks, confirm })` | $n$ ∈ {100, 78, 60, 64} lots | lot $1/n$; blocks 2/4, 1/4, 1/4 | ≈1 byte/stick + 2 bits/throw | temple practice | modeled |
| Tibetan Mo | `castMo(src)` | 36 ordered pairs | 1/36 | $2 \times$ `uniformInt(6)` | Mipham, tr. Goldberg & Dakpa (1990) | modeled |
| Astragaloi | `castAstragaloi(src, 5, { model })` | $4^c$ ordered | faces 1/3/4/6: 1:4:4:1 of 10, or 1/4 | ≈1.02 bytes/bone, or 2 bits | Hagström (1932), as commonly cited | modeled; real bones vary |
| Homer oracle | `castHomeromanteion(src)` | 216 entries | 1/216 | $3 \times$ `uniformInt(6)` | PGM VII.1–148 (Betz 1986) | modeled |

`uniformInt(6)` costs one byte per attempt, accepted with probability
252/256 (expected $256/252 \approx 1.016$ bytes).

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
as often as yin lines (3:5 vs 1:7), exactly as the stalk procedure does:
Hellmut Wilhelm counts 4, 20, 28, 12 of 64 outcomes; Legge's Great Appendix
I.9 gives the procedure (49 of 50 stalks, counted by fours, 18 changes per
hexagram). Moving lines invert to form the *relating* hexagram. Consumption:
exactly 18 bits (coins) or 24 bits (yarrow), 3 bytes either way.

Physical methods built to reproduce the yarrow odds from 16 equiprobable
outcomes — the 16-token method, two coins thrown twice, four coins — are
**probability-identical to `'yarrow'`**; use it for them.

`method: 'singleLine'` is Crowley's six coins or sticks with one "especial"
piece (*Liber CCXVI*): six independent fair lines plus exactly one moving
line, $1 + $ `uniformInt(6)` — 384 equiprobable outcomes, where the
traditional methods move zero to six lines.

Structure helpers (pure): `nuclearHexagram` (lines 2–4 under 3–5),
`inverseHexagram` (turned 180°), `oppositeHexagram` (all lines changed),
`fuXiNumber` / `hexagramFromFuXi` (binary 0–63 with line 1 most significant:
Kun 0, Bo 1, …, Qian 63; the traditional Fu Xi sequence position is
$64 - n$). The King Wen order pairs each odd hexagram with its inverse, or
with its complement for the self-inverse pairs 1/2, 27/28, 29/30, 61/62
(verified over all 64 in the tests). `hexagram.name.legge` carries Legge's
romanization for the 11 titles verified against two copies of his
translation (`LEGGE_NAMES`).

### Tarot — `castSpread(input, spread, { reversals, significator })`

Uniform deal without replacement from the full 78-card RWS deck
(22 majors; Wands/Cups/Swords/Pentacles × Ace–King). Spreads: `single`,
`threeCard`, `celticCross` (10 positions, modern labels), `celticCrossWaite`,
or any custom `{ id, name, positions }` object. Each of the $78!/(78-m)!$
ordered deals is exactly equiprobable.

- **`celticCrossWaite`** follows Waite's own procedure (*Pictorial Key*,
  1911, Part III §7) in his deal order: covers, crosses, crowns, beneath,
  behind, before, himself, his house, hopes or fears, what will come. The
  modern `celticCross` permutes positions 3–5 (its Foundation, Recent Past,
  Crown are Waite's beneath, behind, crowns).
- **`significator`** (a card id such as `'m11'`, or a card) withdraws that
  card first and deals from the remaining 77 — Waite lays the Significator
  down, then shuffles "the rest of the pack". Choosing it is up to you.
- **`reversals`**: `true` reverses each card with probability exactly 1/2
  (one bit, drawn after all cards); `{ reversed, upright }` gives exactly
  $r/(r+u)$ — $k$ bits per card when $r + u = 2^k$, otherwise one
  rejection-sampled `weightedIndexRational` per card. No canonical rate
  exists: Waite prints reversed meanings, while the Golden Dawn's Book T
  holds that a card "has the same meaning and forces, whether right or
  inverted".

### Runes — `castRunes(input, countOrLayout, { futhark, blank, merkstave })`

Uniform draw without replacement from a rune row:

| `futhark` | runes | order and names |
|---|---|---|
| `'elder'` (default) | 24 | Fehu … Othala (Thorsson 1984; identical in Gundarsson 1990) |
| `'younger'` | 16 | fé úr þurs óss reið kaun · hagall nauðr íss ár sól · týr bjarkan maðr lǫgr ýr — Norwegian rune poem (Dickins 1915), long-branch glyphs, ættir 6/5/5 |
| `'futhorc29'` | 29 | Old English rune poem stanza order: … ing, ēþel, dæg, āc, æsc, ȳr, īor, ēar (Hickes 1705, ed. Dickins 1915) |
| `'futhorc28'` | 28 | the same without īor (manuscript orders differ: Codex Vindobonensis 795 has ēar before ȳr) |
| `'futhorc33'` | 33 | the 29 plus the four unversed runes in Hickes' order: cweorð, calc, stān, gār |

- **`blank: true`** adds the blank rune ($n + 1$, `modern: true`, empty
  glyph): Ralph Blum's 1982 addition ("twenty-four Runes, plus one later
  innovation, a Blank Rune"), rejected by traditional runeworkers — offered,
  labelled.
- **`merkstave`** (Elder Futhark only): each **invertible** rune flips with
  probability exactly 1/2; the nine point-symmetric runes (Gebo, Hagalaz,
  Nauthiz, Isa, Jera, Eihwaz, Sowilo, Ingwaz, Dagaz — "only nine Runes read
  the same Upright and Reversed", Blum) consume no bit. Other rows have no
  modeled reversal convention (`merkstave: true` throws `invalid_input`).
- **`'norns'`** instead of a count draws three runes into Urðr, Verðandi,
  Skuld — that which is, that which is becoming, what should result
  (Gundarsson 1990, p. 102).
- **`castRuneSets(input, [3, 3, 1], opts)`** draws sets with the runes
  returned to the pouch between sets (Arcarti: three for the circumstances,
  three for the courses of action, one for the whole), exactly like
  consecutive `castRunes` calls.
- **Ætt names vary**: Freyr's or Freyja's; Heimdall's or Hagal's (Blum and
  Arcarti use Hagal; Gundarsson gives both); Tyr's (Tiwaz's). The data use
  Freyr, Heimdall, Tyr; futhorc runes and the blank have `aett: null`.

### Geomancy — `castShield(input)`, `houses`, `reconciler`, `partOfFortune`

16 MSB-first bits (2 bytes) form four Mothers of four rows each (Fire, Air,
Water, Earth; 1 = active/single point), uniform over all $2^{16}$ charts.
The rest is the classical derivation (Crowley, *Liber XCVI*, 1909, ch. II;
Skinner 1980): Daughters by transposition, then Nephews, Witnesses, and
Judge by row-wise geomantic addition, which with active $=1$ is exactly

$$r = a \oplus b$$

The field for figures IX–XII keeps its 0.1 name `nieces`; the sources call
them **Nephews**, available as the non-enumerable alias `shield.nephews`.
The Judge always lands on one of the eight even-point figures (each mother
bit enters the XOR pipeline exactly twice) — verified over all 65 536
charts. **Test vector**: *Liber XCVI*'s own worked example (public domain)
is the bytes `CA 34` — Mothers Fortuna Minor, Amissio, Fortuna Major,
Rubeus → Nephews Conjunctio, Caput Draconis, Acquisitio, Rubeus → Witnesses
Tristitia, Tristitia → Judge Populus; points of I–XII = 74 = 6 × 12 + 2, so
the Part of Fortune "falls with II". A second fixture reproduces the Digital
Ambler's 2020 example.

```ts
import { castShield, houses, partOfFortune, reconciler } from '@mindpeeker/oracle'

const chart = await castShield(new Uint8Array([0xca, 0x34])) // Liber XCVI's example
partOfFortune(chart) // { total: 74, index: 2, figure: Amissio }
reconciler(chart).name // 'Fortuna Minor'
houses(chart, { system: 'goldenDawn' })[0]?.name // 'Amissio' — figure II in the Ascendant
```

- `houses(shield, { system })` returns the figure in house $h$ at index
  $h - 1$. `'sequential'` (default, Greer 2009): Mothers → 1–4, Daughters →
  5–8, Nephews → 9–12. `'goldenDawn'` (*Liber XCVI* ch. III; Skinner,
  Appendix III): I→10, II→1, III→4, IV→7, V→11, VI→2, VII→5, VIII→8, IX→12,
  X→3, XI→6, XII→9.
- `reconciler(shield)` — figure XVI = Mother I + Judge ("The Reconciler =
  I + XV").
- `partOfFortune(shield)` — `{ total, index, figure }`: the points of I–XII
  modulo 12 (a remainder of 0 read as 12) name the figure. Skinner reads the
  remainder as a house instead: `houses(shield, { system })[index - 1]`.
  **Parity theorem**: the total is always even, so the Part of Fortune only
  falls on II, IV, VI, VIII, X, or XII (proof in the JSDoc; exhaustive test).
- Attributions are identity data from the *Liber XCVI* table: `sign`
  (`null` for Caput/Cauda Draconis, which carry `node: 'north' | 'south'`),
  `planet`, and `element` — Golden Dawn/Skinner with Fortuna Minor = Fire;
  `figureElement(figure, 'liber96')` gives *Liber XCVI*'s Air variant (four
  figures per element).

### Ifá — `castOdu(input, { method: 'opele' | 'ikin' })`

```ts
import { castCowries, castOdu } from '@mindpeeker/oracle'

const odu = await castOdu(new Uint8Array([0x53]), { method: 'ikin' })
odu.name // 'Okanran Irete' — Bascom's Figure 2
const cowries = await castCowries(new Uint8Array([0xf0, 0x0f]))
cowries.odu.name // 'Eji Ogbe' (8 mouths up)
```

One of the 256 odu from exactly 8 bits, each a mark (`1` = single I,
`0` = double II), probability exactly 1/256 — "with a good divining chain
the probability of each of the figures appearing is equal (1 in 256)"
(Bascom 1969). The name puts the right (male) half first: `'Okanran Irete'`,
or `'Ogbe Meji'` when both halves agree (16 *meji*, 240 combinations). The
method sets the mark order: `'opele'` reads the chain's right four shells,
then the left four, top to bottom; `'ikin'` marks row by row, right then
left (Bascom's Figure 2), so byte `0x53` is Okanran Irete by ikin and Ofun
Owonrin by opele. `ODU_FIGURES` lists the 16 principal odu with Bascom's
marks in the **Ifẹ order** he follows and `rank.southwestern` for the more
widely recognized order — rank orders are lineage-dependent (Bascom records
21 more). Modeled: a palm-nut grasp leaving two nuts is not physically a
1/2 event.

### Sixteen cowries — `castCowries(input)`

Sixteen fair shells, one bit each (`1` = mouth up), exactly 16 bits: the
number up is Binomial(16, 1/2), $P(k) = \binom{16}{k}/65536$
(`COWRIE_ODU[k].ways`), mapped to the odu of Bascom's *Sixteen Cowries*
(1980): 0 Opira, 1 Okanran, 2 Eji Oko, 3 Ogunda, 4 Irosun, 5 Ose, 6 Obara,
7 Odi, 8 Eji Ogbe (12 870/65 536 ≈ 19.6%), 9 Osa, 10 Ofun, 11 Owonrin,
12 Ejila Sebora, 13 Ika, 14 Oturupon, 15 Ofun Kanran, 16 Irete. Real cowries
are not fair coins; no measured face probability is used.

### Kau cim — `castLot(input, { sticks, confirm })`

A stick from a set of 100 (default), 78, 60, or 64: $1 + $
`uniformInt(sticks)`. With `confirm`, each stick is checked by a throw of
the two moon blocks (*jiaobei*), modeled as two fair flat/round blocks:
`'holy'` (one of each) 2/4, `'twoFlat'` 1/4, `'twoRound'` 1/4 — sources
disagree which double throw is "no" and which "laughing", so outcomes are
named by what lands. `confirm: true` shakes again until a holy throw
(Geometric(1/2) attempts, mean 2); `confirm: m` stops after $m$ sticks
(`confirmed` with probability $1 - 2^{-m}$). The final lot is exactly
uniform either way. No lot poems are shipped.

### Tibetan Mo — `castMo(input)`

Two throws of the six-syllable die AH RA PA TSA NA DHI (ordinary-die
equivalents AH 6, RA 2, PA 3, TSA 5, NA 4, DHI 1): answer number
$6 \cdot i_1 + i_2 + 1$ of 36, each exactly 1/36 — RA then DHI is answer 12,
as in the book's example (Mipham, tr. Goldberg & Dakpa, 1990). The
translated answer texts are copyrighted and not shipped; the book's
firmness check (throw again: same pair = firm, reversed = weak) is a second
`castMo`.

### Astragaloi — `castAstragaloi(input, count = 5, { model })`

Each knucklebone lands on 1, 3, 4, or 6. `'hagstrom'` (default) uses the
1:4:4:1 face model commonly attributed to Hagström's 1932 throws —
$P(1) = P(6) = 1/10$, $P(3) = P(4) = 4/10$, drawn exactly with
`weightedIndexRational`; `'uniform'` is the fair 1/4 null (2 bits per bone).
The result carries the ordered `bones`, their `sum`, and the unordered `key`
(`'13346'`; 56 keys for five bones). **Modeled vs measured**: 1:4:4:1 is a
rounded summary, not a property of any particular bone — real tali vary with
species, wear, and shaping; pre-register the model you test against.

### Homer oracle — `castHomeromanteion(input)`

Three dice (PGM VII.1–148: 216 Homeric verses keyed by three throws; "one
die thrown three times would achieve the same purpose"): entry
$36(a-1) + 6(b-1) + c$, each exactly 1/216, in the papyrus order 1-1-1 …
6-6-6. Index only — no verse text.

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
- `expectedBytes(spread | spreadName | { n, count, reversals? }, { reversals?, significator? })`
  — expected consumption of a deal (the `castSpread` option bag works as is)
- `DEFAULT_CAST_CHUNK_BYTES` (32), type `CastReaderOptions` (`signal`,
  `chunkBytes`) shared by every cast's options

Systems (every cast also takes `signal?` and `chunkBytes?`):

- `castHexagram(input, { method? })` (`'coins' | 'yarrow' | 'singleLine'`);
  `nuclearHexagram`, `inverseHexagram`, `oppositeHexagram`, `fuXiNumber`,
  `hexagramFromFuXi`; data: `HEXAGRAMS` (64), `TRIGRAMS` (8), `LINE_WEIGHTS`,
  `LEGGE_NAMES`, `hexagramFromBinary(bits)`
- `castSpread(input, spreadOrName?, { reversals?, significator? })`, data:
  `TAROT_DECK` (78), `SPREADS`
- `castRunes(input, count | 'norns', { futhark?, blank?, merkstave? })`,
  `castRuneSets(input, sizes?, { futhark?, blank?, merkstave? })`; data:
  `ELDER_FUTHARK` (24), `YOUNGER_FUTHARK` (16), `FUTHORC_28`/`_29`/`_33`,
  `FUTHARKS`, `RUNE_LAYOUTS`
- `castShield(input)`, `houses(shield, { system? })`, `reconciler(shield)`,
  `partOfFortune(shield)`, `figureElement(figure, system?)`; data:
  `GEOMANTIC_FIGURES` (16), `HOUSE_SYSTEMS`, `figureFromBinary(bits)`
- `castOdu(input, { method? })`; data: `ODU_FIGURES` (16), `oduFromBinary(bits)`
- `castCowries(input, { shells? })`; data: `COWRIE_ODU` (17)
- `castLot(input, { sticks?, confirm? })`; data: `JIAOBEI_WEIGHTS`
- `castMo(input)`; data: `MO_SYLLABLES` (6)
- `castAstragaloi(input, count?, { model? })`; data: `ASTRAGALUS_FACES`,
  `ASTRAGALUS_WEIGHTS`
- `castHomeromanteion(input)`

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
| `invalid_spread` | unknown spread name (inherited keys like `'constructor'` included), or a malformed / empty / >78-position spread object (>77 with a `significator`) |
| `invalid_input` | caller error: bad `n`/`count`/weights/options (unknown `method`/`futhark`/`system`/`model`/layout, malformed `reversals`, unknown `significator`, non-boolean `blank`/`merkstave`, `merkstave` outside the Elder Futhark, bad `sticks`/`confirm`/`shells`, bad `chunkBytes`/`signal`, `null` options), a malformed shield or hexagram passed to a helper, non-byte values, unrecognized input shape, a reader already in use |
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

Systems (additive unless noted; outputs for the 0.1 options are unchanged):

- **Types widened** (can break exhaustive `switch`es): `CastMethod` adds
  `'singleLine'` (`LINE_WEIGHTS` is now keyed by `LineMethod`); `SpreadName`
  adds `'celticCrossWaite'` (`Object.keys(SPREADS)` has four entries);
  `Rune.aett` / `Rune.aettName` may be `null` (futhorc rows, blank rune);
  `castSpread`'s `reversals` and `DealSpec.reversals` accept
  `{ reversed, upright }`; `castRunes`' second parameter accepts `'norns'`.
- **New fields**: `GeomanticFigure.sign` / `.node`, `Rune.modern`,
  `Hexagram.name.legge` (11 hexagrams), `RuneCast.futhark` / `.blank` /
  `.layout?`, `DrawnRune.position?`, `SpreadCast.significator?`, and the
  non-enumerable `ShieldCast.nephews` alias of `nieces`.
- `houses` moved to its own module and takes `{ system }`; the default is the
  0.1 sequential placement.
- `castRunes` validates its options before `count` (the count bound now
  depends on `futhark` and `blank`); `expectedBytes` rejects `null` options
  and a `significator` given with a `DealSpec`.

## Frontend compatibility notes

Shapes were aligned with the mindpeeker frontend
(`scripts/generate-*.ts`, `server/utils/oracleCast.ts`) where cheap:

- **I-Ching**: `binary` is bottom→top yang=1 (their `hexagrams.json` key);
  `CastLine { position, value, yang, changing }` matches theirs.
- **Tarot**: card ids `m00…m21`, `w/c/s/p01…14` match their `tarot.json`;
  Celtic Cross position names match their spread data.
- **Runes**: lowercase ids match; deliberate divergences — 24 runes by
  default (the blank rune is opt-in, `blank: true`), and Nauthiz is
  *non-invertible* here (its glyph is point-symmetric; the frontend treats it
  as reversible).
- **Geomancy**: figure ids and Fire→Earth `binary` keys match; the chart
  shape (mothers/daughters/nieces/witnesses/judge) matches, carrying full
  figure objects instead of bare strings.
- **Deliberate divergence**: the frontend's `nextInt` is modulo-biased and
  recycles bytes; this package rejects instead — same systems, not
  bit-compatible streams.

## Caveats

- Uniform in ⇒ unbiased out. Feed biased bytes and the guarantee is void —
  condition first (e.g. `@mindpeeker/negentropy`'s extractors).
- Attributions (geomantic signs, elements, planets; odu rank orders; cowrie
  and rune names) follow the cited sources; other traditions differ. Treat
  them as data, not doctrine.
- Physical models are idealized: coins, shells, palm nuts, moon blocks,
  dice, and knucklebones are not guaranteed fair objects. The package gives
  the exact distribution *of the model*; whether a physical procedure
  matches it is an empirical question.
- `uniformInt` consumption is unbounded in the worst case (geometric tail).
  With finite inputs, size generously: a Celtic Cross with reversals needs
  `expectedBytes('celticCross', { reversals: true })` ≈ 13.63 bytes on
  average but can need more.
- No cryptographic claims: this package maps entropy, it does not make it.
