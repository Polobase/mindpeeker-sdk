# @mindpeeker/gematria

Pure, deterministic, multi-tradition **gematria & isopsephy** — assign numeric
values to the letters of a word and relate words of equal value. Hebrew, Greek
and English/Latin, with the classical ciphers plus the modern online ones
(clearly labelled as such).

The value *computation* is exact integer arithmetic: `value(text, cipher)` is a
fixed function of the letters and consumes **zero entropy**. The same word
always returns the same number. What equal values *mean* is a different matter —
see [Honest framing](#honest-framing).

Zero runtime dependencies, browser-safe, ESM. The optional
[`@mindpeeker/gematria/oracle`](#the-oracle-subpath--entropy-bridge) subpath adds
entropy-driven draws by composing [`@mindpeeker/oracle`](../oracle); it is the
only part with a dependency, so the root `.` entry stays a true zero-dep leaf.

```ts
import { value, profile, matches, atbash, notariqon } from '@mindpeeker/gematria'

value('אחד', 'he-hechrachi') // 13  (echad — "One")
value('אהבה', 'he-hechrachi') // 13  (ahavah — "love")
value('θελημα', 'gr-isopsephy') // 93  (Thelema)
value('αγαπη', 'gr-isopsephy') // 93  (Agape)
value('χξϛ', 'gr-isopsephy') // 666 (Rev 13:18)

profile('gematria') // every Latin cipher: ordinal 74, reduction 38, reverse 142, …
atbash('אבג') // 'תשר'  (temurah substitution)
notariqon('Atah Gibor Le-olam Adonai') // 'AGLA'
```

## Ciphers

A **cipher** maps each letter of one script to a non-negative integer; a word's
value is the sum of its letters. The first ten ids are a drop-in superset of the
mindpeeker frontend engine (`server/utils/gematria.ts`) — identical ids, labels
and values — so `profile()` can replace it row-for-row.

### Hebrew (22 letters, aleph=1 … tav=400)

| id | method | rule |
|---|---|---|
| `he-hechrachi` | Standard (Mispar Hechrachi) | absolute value א1 … ק100 ר200 ש300 ת400 |
| `he-gadol` | Large (Mispar Gadol) | as standard, but the five final forms ך=500 ם=600 ן=700 ף=800 ץ=900 |
| `he-siduri` | Ordinal (Mispar Siduri) | position 1–22 |
| `he-katan` | Reduced (Mispar Katan) | each letter's digital root (ק100→1), summed |
| `he-atbash` | Atbash (temurah) | letter $i \mapsto 21 - i$ (א↔ת), scored Hechrachi |
| `he-albam` | Albam (temurah) | letter $i \mapsto (i+11) \bmod 22$, scored Hechrachi |

In every method except Gadol the final ("sofit") forms fold to their base
letter. Niqqud and cantillation marks are stripped; RTL is irrelevant to a sum.
_Sources: torahcalc.com; Mathers, *The Kabbalah Unveiled*; Scholem, *Kabbalah*._

### Greek isopsephy (Milesian)

`gr-isopsephy` — α1 β2 γ3 δ4 ε5 **ϝ/ϛ 6** ζ7 η8 θ9 ι10 κ20 λ30 μ40 ν50 ξ60 ο70
π80 **ϙ 90** ρ100 σ/ς 200 τ300 υ400 φ500 χ600 ψ700 ω800 **ϡ 900**. The bold
letters are the archaic decade numerals (digamma/stigma, koppa, sampi). Text is
lowercased and its accents, breathings and iota subscripts are stripped before
summing. _Source: standard Milesian isopsephy tables._

### English / Latin

| id | cipher | rule | note |
|---|---|---|---|
| `en-ordinal` | Ordinal ("Simple") | A1 … Z26 | |
| `en-reduction` | Reduction (Pythagorean) | per-letter digital root of the ordinal | |
| `en-reverse` | Reverse ordinal | $27 - n$ (A26 … Z1) | |
| `la-agrippa` | Agrippa's Latin | A1 … T100 V200 X300 Y400 Z500, with J600 U700 W900 | **reconstructed historical** |
| `la-jewish` | Jewish Gematria | A1 … T100 U200 V700 W900 X300 Y400 Z500, with J600 | **English-letter convention** |
| `en-english`, `en-sumerian` | "English"/"Sumerian" ×6 | ordinal × 6 (A6 … Z156) | **modern wordplay** |
| `en-english-reverse`, `en-sumerian-reverse` | their reverse variants | reverse ordinal × 6 | **modern wordplay** |

`la-agrippa` reconstructs Agrippa's 23-letter table (*Three Books of Occult
Philosophy*, Bk II, 1533) with the common J/U/W extensions — classical Latin had
no J/U/W and no native alphabetic numerals of this kind. `la-jewish` is the
English-letter cipher used as the default on gematrix.org and Gematrinator: the
same ones/tens/hundreds scale as the 22-letter Hebrew alphabet, with J/V/W
(which Hebrew has no counterpart for) given high sofit-style values 600/700/900.
It differs from `la-agrippa` only at U and V, whose values are swapped. Despite
the name, this is a **modern English-letter convention, not actual Hebrew
gematria** — for that, value Hebrew text under `he-hechrachi`. The `en-english`
/ `en-sumerian` ×6 ciphers are 20th–21st-century inventions popularized by
online calculators (gematrinator.com, bartoll.se); every such cipher has
`modern: true`. _Pass `profile(text, { includeModern: false })` for the
historical set only (`la-jewish` included — it is not one of the ×6 ciphers)._

### Friendly aliases

Anywhere a cipher parameter is accepted, you can pass one of these names
instead of the canonical id — the way online calculators label them:

| alias | resolves to |
|---|---|
| `jewish` | `la-jewish` |
| `hebrew` | `he-hechrachi` |
| `latin` | `la-agrippa` |
| `english` | `en-english` |
| `simple`, `ordinal` | `en-ordinal` |
| `reverse` | `en-reverse` |
| `sumerian` | `en-sumerian` |
| `isopsephy` | `gr-isopsephy` |

`resolveCipherId(ref)` performs this mapping (a canonical id passes through
unchanged); it throws nothing itself — an unresolved alias is simply passed on
to `getCipher`, which throws `unknown_cipher`.

## API

Pure core (`@mindpeeker/gematria`). Every `cipher` parameter below accepts a
canonical `CipherId` or a friendly `CipherAlias` (a `CipherRef`) — see
[Friendly aliases](#friendly-aliases):

- `value(text, cipher): number` — the integer value.
- `analyze(text, cipher): GematriaResult` — value, digital-root `reduced`, and a
  per-letter `byLetter` breakdown. `result.cipher` is always the resolved
  canonical id, even if you passed an alias.
- `profile(text, opts?): GematriaProfile` — every cipher for the detected script
  (`{ text, script, values, byLetter }`); a superset of the frontend result.
- `letterValues(cipher): readonly LetterValue[]` — the frozen alphabet table.
- `reduce(n): number` — the digital root (Mispar Katan / Pythagorean reduction).
- `atbash(text): string`, `albam(text): string` — temurah substitutions (each an
  involution on base-form Hebrew). The substituted string valued as `he-hechrachi`
  equals the `he-atbash` / `he-albam` cipher.
- `notariqon(text, { mode: 'first' | 'last' }): string` — acronym extraction.
- `matches(text, lexicon, cipher): MatchResult` — equal-value words in a
  caller-supplied lexicon, with honest `commonness` (see below).
- `lookup(target, lexicon, cipher): MatchResult` — the reverse of `matches`:
  every lexicon word whose value equals a given number instead of a word's
  (gematrix.org's `?word=<number>` feature). See
  [Reverse lookup](#reverse-lookup--gematria-oracle-entropy--number--words) below.
- `equalValue(a, b, cipher): boolean`.
- `resolveCipherId(ref): CipherId`, `ALIASES` — resolve/inspect the friendly
  alias table.
- `CIPHERS`, `CIPHERS_BY_SCRIPT`, `getCipher`, `cipherFromId`, `detectScript`,
  `normalizeFor`, `GematriaError`, and the types.

Gematria (numeric value), **Notariqon** (acronym), and **Temurah** (Atbash /
Albam) are precisely the three divisions of the *literal Kabbalah* (Scholem).

## The `oracle` subpath — entropy bridge

`@mindpeeker/gematria/oracle` turns the deterministic engine into a divinatory
draw over any byte source, composing `@mindpeeker/oracle`. Every draw is exactly
uniform (rejection-sampled, never modulo) and carries honest entropy accounting
`{ bytesConsumed, bitsUsed }` for the draw alone; identical bytes reproduce an
identical reading.

```ts
import { drawWord, drawByValue, castGematria } from '@mindpeeker/gematria/oracle'

await drawWord(lexicon, source) // { word, bytesConsumed, bitsUsed }
await drawByValue(lexicon, 'he-hechrachi', 26, source) // uniform among value-26 words
await castGematria(lexicon, 'he-hechrachi', source) // word + full profile + equal-value peers
```

The lexicon is caller-supplied — this package ships no word corpus.
`drawByValue` throws `GematriaError('no_match')` when the value filter is empty;
entropy/abort errors from the source propagate unchanged as `OracleError`.

### Reverse lookup / gematria oracle (entropy → number → words)

`lookup(target, lexicon, cipher)` (pure core) is `matches` run backwards — the
gematrix.org `?word=<number>` feature — start from a number and get back every
lexicon word sharing that value, plus the same honest `commonness`:

```ts
import { lookup } from '@mindpeeker/gematria'

lookup(13, lexicon, 'he-hechrachi') // { value: 13, matches: [...], commonness }
```

`castByValue(lexicon, cipher, source, opts?)` (the `oracle` subpath) takes this
one step further: instead of drawing a word from entropy, it draws the
*number* itself, then reports which lexicon words happen to land on it.

```ts
import { castByValue } from '@mindpeeker/gematria/oracle'

await castByValue(lexicon, 'he-hechrachi', source)
// { value, words, commonness, cipher, bytesConsumed, bitsUsed }
```

By default (`mode: 'lexicon'`) the draw is uniform over the lexicon's own
distinct realized values, so `words` is never empty. Pass `mode: 'range'` (with
optional `min`/`max`) to draw uniformly over an arbitrary numeric range
instead — which may land on a value no lexicon word has, giving an empty
`words`.

**Be honest about what this is.** The drawn number is random entropy and
nothing more; the returned words are merely whichever lexicon entries happen
to share that value — a reflection, not a message. `commonness` tells you how
cheap the coincidence is. Nothing here is evidence of anything.

## Honest framing

The value computation is exact, deterministic and well-defined. The
**interpretation** — that words of equal value are *meaningfully related* — is a
contested hermeneutic and contemplative tradition, **not a scientific claim**.
Nothing in this package asserts hidden significance, and you should not read any
into its output.

Two things keep the tool honest:

- **Equal-value matches are statistically cheap.** Many words share any given
  value, so a "match" is close to free. `matches` and `lookup` therefore report
  `commonness` — the fraction of your lexicon at that value — so a coincidence is
  visibly a coincidence. A match at commonness 0.2 is noise.
- **The modern English ciphers are wordplay.** Hebrew and Greek letters *were*
  their numerals; Latin never had native alphabetic numerals of this kind, so
  Ordinal/Reduction/Reverse and the ×6 "English"/"Sumerian" ciphers are recent
  inventions, not ancient systems. They are flagged `modern: true`. `la-jewish`
  is a related case: it borrows Hebrew's numeral *scale*, but it is still a
  20th–21st-century English-letter convention, not Hebrew gematria itself.

R. Eleazar of Worms warned his students to *"do gematria, so that people should
not deride you"* — a reminder that even proponents held the method loosely. As
Alan Moore put it, "gematria is rubbish… I don't mean untrue… a method of
experiencing truth." This package gives you the exact numbers and the honest
denominators; the meaning is yours, and it is not mathematics.

_Sources: Gershom Scholem, *Kabbalah* (the three literal divisions —
Gematria / Notariqon / Temurah); H. C. Agrippa, *De Occulta Philosophia* Bk II;
torahcalc.com (Hebrew method charts); gematrinator.com / bartoll.se (the modern
English ciphers, treated as recent inventions); gematrix.org / gematrinator.com
(the `la-jewish` "Jewish Gematria" table and its `?word=<number>` reverse
lookup)._

## Development

```sh
bun test                       # reference-vector fixture is checked in
bun run typecheck && bun run build
```
