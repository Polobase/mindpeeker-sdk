# @mindpeeker/gematria

Pure, deterministic, multi-tradition **gematria & isopsephy** — assign numeric
values to the letters of a word and relate words of equal value. Hebrew, Greek,
Arabic and English/Latin — the classical ciphers plus the full modern
online-calculator set (clearly labelled as such), including Peter Plichta's
Prime Number Cross — and the alphabetic numerals of Cyrillic, Armenian,
Georgian, Coptic, Syriac and Gothic. **43 ciphers** in all, each of which also
mirrors on demand (`value(text, cipher, true)`).

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

profile('gematria') // the default Latin rows: ordinal 74, reduction 38, Agrippa 233, …
value('gematria', 'en-ordinal', true) // 142 — reverse is a parameter, not a cipher
atbash('אבג') // 'תשר'  (temurah substitution)
notariqon('Atah Gibor Le-olam Adonai') // 'AGLA'
```

## Ciphers

A **cipher** maps each letter of one script to a non-negative integer; a word's
value is the sum of its letters. The nine frontend-parity ids (`he-hechrachi`,
`he-gadol`, `he-siduri`, `he-katan`, `he-atbash`, `he-albam`, `gr-isopsephy`,
`en-ordinal`, `en-reduction`) are a drop-in superset of the mindpeeker frontend
engine (`server/utils/gematria.ts`) — identical ids, labels and values — so
`profile()` can replace it row-for-row. The registry spans **43 ciphers** in
total (`CIPHERS.length`): the SDK-added *extended* methods (`extended: true`)
are kept out of the default `profile()`, and the modern calculator ciphers
(`modern: true`) can be dropped with `includeModern: false`.

| script | ciphers | default `profile()` rows |
|---|---|---|
| Hebrew | 11 | 6 (+5 extended) |
| Greek | 2 | 1 (+1 extended) |
| Arabic | 1 | 1 |
| Latin | 23 | 17 (+6 extended) |
| Cyrillic, Armenian, Georgian, Coptic, Syriac, Gothic | 1 each | 1 |

**Alphabet and fold.** Every cipher has a canonical `alphabet` (one glyph per
letter, in traditional order) and a `fold(ch)` that maps final forms, numeral
variants, case and script variants to the canonical letter (ם→מ, ς→σ, ϛ→ϝ,
Є→е, Nuskhuri ⴀ→ა). `table` lists every value-bearing glyph with its value.

**Reverse is a parameter, not a cipher.** `value(text, cipher, true)` mirrors
*any* cipher over its canonical alphabet: a character folds to its letter at
index $i$ and takes the forward value of the letter at $n-1-i$ — a↔z for Latin,
aleph↔tav for Hebrew (finals mirror like their base letter, so reversed
Hechrachi is exactly Atbash), α↔ϡ over the 27 Milesian numerals for Greek. Glyph
variants therefore always share a reversed value, and reversing twice returns
the forward cipher. `analyze(text, cipher, { reverse: true })` and
`letterValues(cipher, true)` take the same switch; the third argument of
`value`/`letterValues` may also be an options object `{ reverse, keepTen,
namesVariant }` (see below).

```ts
import { value } from '@mindpeeker/gematria'

value('gematria', 'en-ordinal') // 74
value('gematria', 'en-ordinal', true) // 142 — the reverse ordinal, 27 − n
value('שלום', 'he-hechrachi', true) // 112 — equals value('שלום', 'he-atbash')
value('λογος', 'gr-isopsephy', true) // 838 — final and medial sigma agree
value('Trump Heights', 'en-reduction', { keepTen: true }) // 74 — Hubbard's S = 10
```

### Hebrew (22 letters, aleph=1 … tav=400)

| id | method | rule |
|---|---|---|
| `he-hechrachi` | Standard (Mispar Hechrachi) | absolute value א1 … ק100 ר200 ש300 ת400 |
| `he-gadol` | Large (Mispar Gadol) | as standard, but the five final forms ך=500 ם=600 ן=700 ף=800 ץ=900 |
| `he-siduri` | Ordinal (Mispar Siduri) | position 1–22 |
| `he-katan` | Reduced (Mispar Katan) | each letter's digital root (ק100→1), summed |
| `he-atbash` | Atbash (temurah) | letter $i \mapsto 21 - i$ (א↔ת), scored Hechrachi |
| `he-albam` | Albam (temurah) | letter $i \mapsto (i+11) \bmod 22$, scored Hechrachi |
| `he-milui` | Full Spelling (Milui / Mispar Shemi) — **extended** | value of each letter's spelled-out name (alef → אלף = 111) |
| `he-kidmi` | Triangular (Kidmi) — **extended** | cumulative Σ of standard values up to each letter (א1 ב3 ג6 …) |
| `he-perati` | Squared (Perati) — **extended** | each letter's standard value squared |
| `he-neelam` | Hidden (Neelam) — **extended** | milui(letter) − hechrachi(letter) |
| `he-katan-mispari` | Integral Reduced — **extended** | digital root of the whole word's Hechrachi total |

In every method except Gadol the final ("sofit") forms fold to their base
letter; Gadol alone gives them 500–900 forward, and under reverse a final
mirrors like its base letter (so `value('את', 'he-gadol', true)` is 401).
Niqqud and cantillation marks are stripped; RTL is irrelevant to a sum.
`milui(text, variant?)` additionally exposes the four divine-name spellings of
יהוה — **AB=72, SAG=63, MAH=45, BAN=52** (variant ids are case-insensitive:
`'ab'` or `'AB'`; an unknown variant throws `invalid_input`).

**Letter-name spellings.** The default names (`HE_NAMES`) keep frontend parity
and spell gimel גמל (73) and pe פא (81). `namesVariant: 'plene'` — accepted by
`value`/`analyze`/`letterValues` for `he-milui` and `he-neelam`, and by
`milui(text, { variant, namesVariant })` — spells gimel גימל (83) and pe פה (85)
instead, as in Crowley's *Sepher Sephiroth* (Pe = PH 85, gimel also GYML 83) and
Godwin's *Cabalistic Encyclopedia*. It raises a `he-milui` or `he-neelam` total
by 10 per gimel and 4 per pe (`value('גד', 'he-milui', { namesVariant: 'plene' })`
is 517, not 507); every other letter name is unchanged.
_Sources: Agrippa, *De Occulta Philosophia* II.xix; torahcalc.com; Mathers,
*The Kabbalah Unveiled*; Crowley, *Sepher Sephiroth* (Equinox I.8, 1912);
Scholem, *Kabbalah*._

### Greek

`gr-isopsephy` (Milesian) — α1 β2 γ3 δ4 ε5 **ϝ/ϛ 6** ζ7 η8 θ9 ι10 κ20 λ30 μ40
ν50 ξ60 ο70 π80 **ϙ/ϟ 90** ρ100 σ/ς 200 τ300 υ400 φ500 χ600 ψ700 ω800 **ϡ 900**.
The bold letters are the archaic decade numerals (digamma/stigma, koppa,
sampi). The canonical alphabet is the 27 numeral letters, so reverse pairs α↔ϡ,
ζ↔τ, η↔σ, θ↔ρ … with ν fixed.

`gr-ordinal` — **extended** — Agrippa's "first manner" of Greek numeration
(II.xviii): each of the 24 letters scores its place, α1 … σ/ς18 … ω24; the
archaic numerals score 0 (Hubbard's Σ18 + Π16 + Φ21 = 55).

Text is lowercased and its accents, breathings and iota subscripts are stripped
before summing; the symbol letters ϐ ϑ ϕ ϖ ϰ ϱ ϲ ϵ score as their letters (see
[Normalization](#normalization)). _Sources: Agrippa, *De Occulta Philosophia*
II.xviii; standard Milesian isopsephy tables._

### Arabic Abjad (Ḥisāb al-Jummal, Mashriqi order)

`ar-abjad` — the 28-letter Eastern Abjad numerals filling the ones, tens,
hundreds and a final thousand: ا1 ب2 ج3 د4 ه5 و6 ز7 ح8 ط9 ي10 ك20 ل30 م40 ن50
س60 ع70 ف80 ص90 ق100 ر200 ش300 ت400 ث500 خ600 ذ700 ض800 ظ900 **غ1000**.

Counting conventions (applied during normalization and by the cipher's `fold`):
a hamza on a seat counts as its seat letter (أ إ آ → ا, ؤ → و, ئ → ي), alef
wasla ٱ → ا, tāʾ marbūṭa ة → ه (5), alef maqsūra ى → ي (10), and the Persian/Urdu
code points keheh ک → ك and farsi yeh ی → ي. The free-standing hamza ء, the
harakāt, tanwīn, dagger alef and tatwīl carry no value; the Persian-only letters
پ چ ژ گ score 0; presentation forms and ligatures (ﻻ, ﷲ) count as their letters.
So `value('موسى', 'ar-abjad')` is 116 and `value('سؤال', 'ar-abjad')` is 97.
Summing is order-independent, so RTL needs no special handling. The
Western/Maghribi order is not shipped. `modern: false` — the Abjad numerals are
the historical pre-Hindu-Arabic number system of the script.
_Sources: Freedman's comparative Greek/Hebrew/Arabic numeral table; standard
Ḥisāb al-Jummal tables._

### English / Latin

| id | cipher | rule | note |
|---|---|---|---|
| `en-ordinal` | Ordinal ("Simple English") | A1 … Z26 | `modern: false` for frontend parity |
| `en-reduction` | Reduction ("Pythagorean") | per-letter digital root of the ordinal; `keepTen` option | `modern: false` for frontend parity |
| `la-agrippa` | Agrippa's Latin key | A1 … T100 U200 X300 Y400 Z500 J600 V700 W900 | **historical** (II.xx) |
| `la-jewish` | Jewish Gematria | the same table as `la-agrippa` | **English-letter convention** |
| `en-naeq` | New Aeon English Qabalah (NAEQ / ALW) | A1 L2 W3 H4 S5 D6 O7 Z8 K9 V10 … P26 | **extended** (Thelemic) |
| `en-english`, `en-sumerian` | "English"/"Sumerian" ×6 | ordinal × 6 (A6 … Z156) | **modern wordplay** |

**Agrippa and "Jewish Gematria" are one table.** Agrippa (*De Occulta
Philosophia* II.xx, 1533) fills the 27 numeral places with A1 … I9, K10 … T100,
the vowel V = 200, X300 Y400 Z500, and then — "I, and V simple consonants, as in
the names of John, and Valentine, and hi, and hu aspirate consonants" —
consonantal I = 600, consonantal V = 700, HI = 800 and HV = 900. Read with modern
letters that is U200, J600, V700, W900: J/U/W are Agrippa's own assignments, not
a later reconstruction, and the digraph HI (800) is not scored (H and I count 8 +
9). The "Jewish Gematria" default of gematrix.org and Gematrinator is exactly
this table under a modern name (Hubbard's *Number Games* confirms U200/V700 with
"Tisha B'Av" = 911); both ids are kept. Despite the name, `la-jewish` is an
**English-letter convention, not actual Hebrew gematria** — for that, value
Hebrew text under `he-hechrachi`.

**NAEQ lineage.** The ALW cipher was discovered by James Lees in November 1976,
derived from *Liber AL vel Legis*. It is not the cipher of *Liber Trigrammaton*
— that is R. Leo Gillis's Trigrammaton Qabalah (`en-tq`, below).

**`keepTen`.** `value(text, 'en-reduction', { keepTen: true })` applies
Hubbard's rule that S (ordinal 19) may count 10 instead of 1; under reverse the
same rule falls on H, the mirror of S. `'Trump Heights'` is 65 plainly and 74
with `keepTen`. The option is rejected (`invalid_input`) on any other cipher.

The `en-english` / `en-sumerian` ×6 ciphers are 20th–21st-century inventions
popularized by online calculators (gematrinator.com, bartoll.se); every such
cipher has `modern: true`. _Pass `profile(text, { includeModern: false })` for
the non-modern set only (`la-jewish` included — it is not one of the ×6
ciphers)._

**Calculator name crosswalk.** Simple English = `en-ordinal`; Reverse Simple =
`en-ordinal` with `reverse`; Pythagorean = `en-reduction` (Reverse Pythagorean
with `reverse`); Sumerian / Reverse Sumerian = `en-sumerian` (with `reverse`);
Jewish = `la-jewish`; Satanic = `en-satanic`; English Extended = `en-standard`.

#### Modern calculator ciphers (gematriaq.com parity)

Beyond the ×6 family the package ships the full modern online-calculator set —
all `modern: true`, all 20th–21st-century inventions with no ancient pedigree
(Latin has no native numerals). They are in `profile()` by default; pass
`includeModern: false` to drop them.

| id | cipher | rule |
|---|---|---|
| `en-standard` | Standard | A–I ones 1–9, J–R tens 10–90, S–Z hundreds 100–800 |
| `en-satanic` | Satanic | the ordinal + 35 (A36 … Z61) |
| `en-primes` | Primes | the nth prime by ordinal position, A2 B3 … Z101 |
| `en-squares` | Squares | the ordinal squared, A1 … Z676 |
| `en-trigonal` | Trigonal | triangular number T(n)=n(n+1)/2, A1 … Z351 |
| `en-fibonacci` | Fibonacci | the nth Fibonacci number, A1 B1 C2 D3 … Z121393 |
| `en-chaldean` | Chaldean | traditional 1–8 table (9 held sacred, never assigned) |
| `en-septenary` | Septenary | ordinal cycled through seven, (n−1) mod 7 + 1 |
| `en-keypad` | Keypad | the E.161 telephone-keypad digit (ABC=2 … WXYZ=9) |

#### Prime Number Cross (Peter Plichta)

Two ciphers built on Peter Plichta's **Prime Number Cross** (*God's Secret
Formula: The Prime Number Code*, 1997): the integers laid on a 24-spoke wheel
where — since 1, 2, 3 are indivisible — 6 is flanked by 5 and 7, and every prime
$> 3$ has the form **6n±1**, so all such primes fall on the cross's rays.
`modern: true`. The **Cross** is the whole 6n±1 lattice (composites and all);
the **Prime Cross** keeps only the numbers on it that are actually prime.

| id | cipher | rule |
|---|---|---|
| `en-cross` | Cross | the successive 6n±1 numbers — the whole lattice, A1 B5 C7 … Z77 (composites 25, 35, 49, 65, 77 kept) |
| `en-prime-cross` | Prime Cross | only the primes on the cross, keeping the central 1: A1 B5 C7 … Z103 (1 + every prime except 2, 3) — no composites |

Cross and Prime Cross agree A–H, then diverge at I (25 vs 29) — the cross's
own distinction between candidate numbers and the primes among them.

#### Further Latin tables (extended)

All `extended: true`; each has its own canonical alphabet, so reverse mirrors
over that alphabet.

| id | cipher | rule |
|---|---|---|
| `en-tq` | Trigrammaton Qabalah | R. Leo Gillis (1996), base 3 from *Liber Trigrammaton*: I0 L1 C2 H3 P4 A5 X6 J7 W8 T9 O10 G11 F12 E13 R14 S15 Q16 K17 Y18 Z19 B20 M21 V22 D23 N24 U25 &26; alphabet a…z & |
| `en-aq` | Alphanumeric Qabbala | Ccru / Nick Land (`modern: true`): base-36 digit values, digits 0–9 and A10 … Z35 — the only cipher that scores digits |
| `la-elizabethan-simple` | Elizabethan Simple | 24 letters, I/J = 9 and U/V = 20: A1 … H8, I/J9, K10 … T19, U/V20, W21 X22 Y23 Z24 (BACON = 33) |
| `la-elizabethan-kaye` | Kaye | K10 … Z24, & 25, A27 … I/J35 (the "et" sign, 26, is not scored) |
| `la-roman` | Roman numerals | I1 V5 X10 L50 C100 D500 M1000, all other letters 0 (U and J included) |

`la-roman` is the polemical isopsephy of Andreas Helwig (1612) and Uriah Smith
(1866): VICARIVS FILII DEI = 666, a title that was never an official papal title
— and "VICARIUS" with a U gives 661, a reminder of how much such readings depend
on spelling choices. Elizabethan reverse is Hall's "Reverse" cipher (Z1 … A24).
_Sources: gematriaresearch.blogspot.com, "History of Ciphers" (Baconian and
Thelemic parts); Manly P. Hall, *The Secret Teachings of All Ages*._

### Alphabetic numerals of further scripts

Each of these scripts wrote numbers with its letters on the Greek/Semitic
pattern; a word's value is the sum of its letters. Each is `modern: false`, the
sole cipher of its script (so `profile()` of Cyrillic, Armenian, … text returns
it), and mirrors over its numeral positions. Letter-sum gematria is well attested
in the Greek, Hebrew, Arabic, Syriac and Coptic milieus; for the others these
ciphers apply the numeral values mechanically.

| id | script | values |
|---|---|---|
| `cu-cyrillic` | Cyrillic / Church Slavonic | а1 в2 г3 д4 е5 ѕ6 з7 и8 ѳ9, і10 к20 л30 м40 н50 ѯ60 о70 п80 ч90, р100 с200 т300 у400 ф500 х600 ѱ700 ѡ800 ц900; variants є=5, ҁ=90, ѵ/ꙋ=400, ѿ/ꙍ=800, ѧ=900; titlo and ҂ carry no value |
| `hy-numerals` | Armenian | ա1…թ9, ժ10…ղ90, ճ100…ջ900, ռ1000…ք9000, and the later letters օ10000 ֆ20000 |
| `ka-numerals` | Georgian | ა1 … თ9 (ჱ8), ი10 … ჟ90 (ჲ60), რ100 … შ900 (ჳ/უ400), ჩ1000 … ჰ9000 (ჴ7000), ჵ10000; Mtavruli, Asomtavruli and Nuskhuri fold to Mkhedruli |
| `cop-numerals` | Coptic | the Greek values on ⲁ … ⲱ with sou ⲋ6, fai ϥ90, sampi ⳁ900; ϣ ϧ ϩ ϫ ϭ ϯ score 0 |
| `syr-numerals` | Syriac | the Hebrew values on the 22 letters, ܐ1 … ܬ400; final semkath ܤ = ܣ |
| `got-numerals` | Gothic | 𐌰1 … 𐌸9, 𐌹10 … 𐍀80, 𐍁90, 𐍂100 … 𐍉800, 𐍊900 |

Anchors from the sources: ՌՋՀԵ = 1975, ჩყმვ = 1846, ѰЗ = 707, •𐌹𐌱• = 12.
_Sources: Wikipedia, "Cyrillic numerals", "Armenian numerals", "Georgian
numerals", "Coptic script", "Syriac alphabet", "Gothic alphabet"; *The Coptic
Encyclopedia*, "Numbers"._

### Normalization

`normalizeFor(text, script)` runs before every sum (and `detectScript(text)`
picks the script for `profile()`). First, Unicode *format* characters (category
Cf: ZWJ, ZWNJ, LRM/RLM, ALM, bidi embeddings and isolates, the BOM, soft hyphen)
are removed, so invisible controls never hide a letter; no-break spaces become
ordinary spaces. Then, per script:

- **Hebrew** — NFKC, niqqud and cantillation stripped, Yiddish ligatures װ ױ ײ
  expanded; presentation forms (ﬡ, ﭏ → אל) and ℵ ℶ ℷ ℸ count as letters; finals
  kept for Gadol.
- **Arabic** — NFKD (hamza marks split off their seats, presentation forms
  decompose), marks and tatwīl stripped, the Abjad conventions above folded.
- **Greek, Latin and the numeral scripts** — NFKD, every combining mark stripped
  (accents, breathings, titlo, overlines, Syriac points), lowercased. This is a
  deliberate compatibility policy: ϑ ϕ ϖ ϰ ϱ ϲ score as θ φ π κ ρ ς, ﬁ as fi,
  fullwidth and mathematical letters as their letters, Ⅷ as viii, ™ as tm; Й, Ё,
  Ї lose their marks.

Script detection order: Hebrew › Arabic › Syriac › Coptic › Greek › Cyrillic ›
Armenian › Georgian › Gothic › Latin. An unknown script name throws
`unsupported_script`.

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
| `sumerian` | `en-sumerian` |
| `isopsephy` | `gr-isopsephy` |

`resolveCipherId(ref)` performs this mapping (a canonical id passes through
unchanged); it throws nothing itself — an unresolved alias is simply passed on
to `getCipher`, which throws `unknown_cipher`.

## Literal-Kabbalah tools

Gematria (numeric value), **Notariqon** (acronym) and **Temurah** (letter
exchange) are the three divisions of the *literal Kabbalah* (Scholem). Every
tool below normalizes Hebrew first (niqqud stripped), rejects a non-string with
`GematriaError('invalid_input')`, and leaves non-Hebrew characters untouched.

### Temurah and the twenty-two Tziruph tables

```ts
import { achbi, aibat, albam, ALBATH, atbash, avgad, temurahShift, tziruph } from '@mindpeeker/gematria'

atbash('יהוה') // 'מצפצ'  (א↔ת, ב↔ש, …)
albam('אבג') // 'למנ'  (i ↦ i + 11)
avgad('יהוה') // 'כוזו'  (each letter → the next; the mezuzah name)
temurahShift('תורה', 1) // the same shift by any n (negative undoes it)
achbi('אבגד') // 'כיטח'  (א↔כ, ב↔י, …; ו and פ fixed)
aibat('אבגד') // 'יטחז'  (א↔י, ב↔ט, …; כ and ת fixed)
tziruph('רוח', ALBATH) // 'דצע'  (Mathers: by Albath RVCh becomes DTzO)
```

**Achbi and Aibat.** Every commutation is named after its first two pairs, so
Achbi (אכב״י) is א↔כ, ב↔י: each half of eleven letters reversed onto itself,
with ו and פ fixed. Aibat (איב״ט), Ginsburg's table no. 10, is א↔י, ב↔ט with כ
and ת fixed. 0.1.x shipped the Aibat mapping under the name `achbi`; it now lives
at `aibat`.

**Tziruph.** `tziruph(text, k, { selfPairs? })` applies any of the twenty-two
tables Mathers lists ("the alphabet is bent exactly in half … twenty-two
commutations are produced"). With the letters numbered 1 … 22, table $k$ pairs
$i$ with $j \equiv k - i \pmod{22}$ (0 meaning ת), a reflection of the letter
circle and therefore an involution. For even $k$ two letters are their own
mirror; by default (`selfPairs: 'swap'`) they are paired with each other, as in
Mathers' printed Albath table (א over ל); `selfPairs: 'fixed'` leaves them
alone. Mathers prints only Albath in full, and the two readings are each
consistent with all but one name: under `'swap'` every name is the table's first
two pairs except Agdath (AGDTh skips ב), under `'fixed'` every name except
Albath. `tziruph(x, ACHBI, { selfPairs: 'fixed' })` is `achbi(x)`, and
`tziruph(x, ATHBASH)` is `atbash(x)`.

| k | constant | name | first pairs | Ginsburg no. |
|---|---|---|---|---|
| 1 | `ATHBASH` | Athbash | א↔ת ב↔ש | 22 |
| 2 | `ALBATH` | Albath | א↔ל ב↔ת | 1 |
| 3 | `ABGATH` | Abgath | א↔ב ג↔ת | 2 |
| 4 | `AGDATH` | Agdath | א↔ג ד↔ת | 3 |
| 5 | `ADBAG` | Adbag | א↔ד ב↔ג | 4 |
| 6 | `AHBAD` | Ahbad | א↔ה ב↔ד | 5 |
| 7 | `AVBAH` | Avbah | א↔ו ב↔ה | 6 |
| 8 | `AZBAV` | Azbav | א↔ז ב↔ו | 7 |
| 9 | `ACHBAZ` | Achbaz | א↔ח ב↔ז | 8 |
| 10 | `ATBACH` | Atbach | א↔ט ב↔ח | 9 |
| 11 | `AIBAT` | Aibat | א↔י ב↔ט | 10 |
| 12 | `ACHBI` | Achbi | א↔כ ב↔י | 11 |
| 13 | `ALBACH` | Albach | א↔ל ב↔כ | 12 |
| 14 | `AMBAL` | Ambal | א↔מ ב↔ל | 13 |
| 15 | `ANBAM` | Anbam | א↔נ ב↔מ | 14 |
| 16 | `ASBAN` | Asban | א↔ס ב↔נ | 15 |
| 17 | `AOBAS` | Aobas | א↔ע ב↔ס | 16 |
| 18 | `APBAO` | Apbao | א↔פ ב↔ע | 17 |
| 19 | `ATZBAP` | Atzbap | א↔צ ב↔פ | 18 |
| 20 | `AQBATZ` | Aqbatz | א↔ק ב↔צ | 19 |
| 21 | `ARBAQ` | Arbaq | א↔ר ב↔ק | 20 |
| 22 | `ASHBAR` | Ashbar | א↔ש ב↔ר | 21 |

`TZIRUPH_TABLES` carries this metadata (`k`, `name`, Mathers' `abbreviation`,
`ginsburg`). `tziruphSquare('right' | 'averse')` builds Mathers' Right and
Averse "Tables of the Commutations" (22 × 22; row $r$ of the Right table is
`temurahShift` by $r$). The ciphers `he-atbash` / `he-albam` score the
substituted word: `value(atbash(x), 'he-hechrachi') === value(x, 'he-atbash')`.
_Sources: Mathers, *The Kabbalah Unveiled* (1887), Introduction; Ginsburg, *The
Kabbalah* (1865), p. 55; Regardie, *The Complete Golden Dawn System of Magic*._

### Aiq Beker (the nine chambers)

```ts
import { aiqBeker, aiqBekerEquivalent, aiqBekerSubstitute, chamberMates, chamberReduce } from '@mindpeeker/gematria'

aiqBeker('ק') // { chamber: 1, position: 3 }
chamberMates('ד') // ['מ', 'ת']
aiqBekerSubstitute('אמת', 1) // 'אדד'  (every letter to its chamber's units member)
aiqBekerEquivalent('אדם', 'אמת', { finals: 'fold' }) // true — 45 ↔ 441
chamberReduce(666) // 9
```

`NINE_CHAMBERS` lists the triads (units, tens, hundreds), the hundreds running on
into the finals ך … ץ = 500 … 900. By default the finals are those distinct
hundreds (`{ finals: 'distinct' }`, as in `aiqBeker`); `{ finals: 'fold' }`
counts a final as its base letter, the reading of *Sepher Sephiroth*'s "Truth;
Temurah of ADM, by Aiq Bekar AMTh" (אדם 45 → אמת 441).

### Notariqon

`notariqon(text, { mode: 'first' | 'last' })` and `acronym(text, { from:
'first' | 'last' | 'medial' })` take one letter from each whitespace-separated
word. Only letters count (Unicode category L): vowel points, cantillation,
accents, digits and punctuation are never picked. Hebrew and Arabic words are
normalized first (finals kept as written); other scripts are composed to NFC, so
letters keep their case and accents.

```ts
import { acronym, notariqon } from '@mindpeeker/gematria'

notariqon('אַתָּה גִּבּוֹר לְעוֹלָם אֲדֹנָי') // 'אגלא'
notariqon('לְךָ', { mode: 'last' }) // 'ך' (not the qamats)
acronym('Atah, Gibor', { from: 'last' }) // 'hr'
```

### Hebrew numerals and number-lore

`toHebrewNumeral(n, { finals?, punctuation? })` writes $1 \le n \le 999\,999$
with Hebrew letters: hundreds above 400 as ת-compounds (900 = תתק) or, with
`finals: true`, as ך ם ן ף ץ; 15 = טו and 16 = טז; thousands marked with a geresh
(5784 = ה׳תשפ״ד); gershayim/geresh by default. For $n \le 999$ the numeral's
`he-hechrachi` value is $n$ (with finals, its `he-gadol` value). Other
avoidances some writers apply (ער for 270) are not applied.

`numberProperties(n)` gives the exact portrait of an integer in $[0, 2^{48}]$
(`MAX_NUMBER`): digit sum, digital root, primality, prime factorization (one
trial-division sweep), triangular index, square and perfect flags.
`analyze(text, cipher, { numberProperties: true })` attaches it to a result.

```ts
import { numberProperties, toHebrewNumeral } from '@mindpeeker/gematria'

toHebrewNumeral(15) // 'ט״ו'
toHebrewNumeral(5784) // 'ה׳תשפ״ד'
numberProperties(666) // { digitSum: 18, digitalRoot: 9, isTriangular: true, triangularIndex: 36, … }
```

## Lexicons, matching and commonness

### Equal-value matching

`matches(text, lexicon, cipher, opts?)` returns the lexicon words sharing
`text`'s value; `lookup(n, lexicon, cipher, opts?)` starts from a number
(gematrix.org's `?word=<number>`); `equalValue(a, b, cipher, opts?)` compares
two words. `opts.colel: true` is the traditional ±1 window and
`opts.tolerance: n` a ±n one; `matches` lists every word within the window and
`exact` the strictly equal subset.

A lexicon is an array of words and/or `{ word, script? }` objects
(`LexiconWord`). Under a cipher only its **admissible** words count: written in
the cipher's script (the declared `script`, else `detectScript(word)`) and
containing at least one letter the cipher scores. A Greek or English entry is
therefore never a zero-valued "match" under a Hebrew cipher, and it is not in
the denominator: `commonness = matches.length / lexiconSize`.
`admissibleWords(lexicon, cipher)` lists them.

**Default lexicon.** `useDefaultLexicon(lexicon)` registers a lexicon for the
two-argument overloads `matches(text, cipher)` / `lookup(n, cipher)` (and the
oracle's `castByValue(cipher, source)`); `getDefaultLexicon(cipher?)` returns
its words (only the admissible ones with a cipher), and `clearDefaultLexicon()`
forgets it. Importing `@mindpeeker/gematria/lexicon` registers the bundled
corpus. For isolation, `createLexiconRegistry()` returns an independent
`LexiconRegistry` (`use`, `lexicon`, `words`, `has`, `clear`) whose `lexicon()`
you pass explicitly.

```ts
import { lookup, matches } from '@mindpeeker/gematria'
import { defaultLexicon } from '@mindpeeker/gematria/lexicon'

defaultLexicon() // registers the bundled corpus (so does importing the subpath)
lookup(156, 'he-hechrachi') // matches ['באבאלען', 'ציון', 'יוסף'], commonness 3/160
matches('אמת', 'he-hechrachi').matches // ['אמת', 'אילת']
lookup(358, 'he-hechrachi', { colel: true }).matches // ['משיח', 'נחש', 'יבא שילה']
```

### Commonness 2.0

A single `commonness` says how crowded one value is. The whole-lexicon
statistics say how cheap equal values are *before* any word is looked up.

- `collisionProfile(lexicon, cipher, { tolerance?, colel?, weights? })` →
  `{ cipher, tolerance, n, distinct, histogram, collisionProbability,
  collisionEntropyBits, expectedEqualPairs, observedEqualPairs, birthdayBound50 }`.
  With value probabilities $p_v$ (word counts, or token `weights` — a `Map` from
  word to frequency), the collision probability of two independent draws is
  $q = \sum_v p_v \sum_{|u-v| \le t} p_u$ ($\sum_v p_v^2$ for $t = 0$), its
  Rényi-2 entropy $-\log_2 q$ bits, $\binom{n}{2} q$ the equal pairs expected
  among $n$ draws (without weights it exceeds the exact `observedEqualPairs` by
  $n(1-q)/2$, the draws that repeat an entry), and `birthdayBound50`
  $\approx \sqrt{2 \ln 2 / q}$ the draws after which a coincidence is more likely
  than not.
- `expectedMatches(lexicon, cipher, opts?)` — the expected `matches.length` of a
  query drawn from the lexicon itself (uniformly, or by `weights`); without
  weights $n q$. A word with no more matches than this is unremarkable.
- `birthdayBound(q, probability = 0.5)` — $\sqrt{2 \ln(1/(1-P)) / q}$ (22.49 for
  365 equally likely birthdays; the exact answer is 23).
- `pairMatchTest(pairs, cipher, { tolerance?, colel?, method?, permutations?,
  seed? })` — the pairing permutation test of McKay, Bar-Natan, Bar-Hillel &
  Kalai applied to equal-value claims: the statistic is the number of pairs
  $(a_i, b_i)$ that agree; the null re-pairs the second column at random. The
  p-value is exact ($P(S \ge S_\text{obs})$ over all $n!$ pairings, by subset
  dynamic programming, $n \le 16$; `method: 'auto'` does this for $n \le 12$) or
  a Monte Carlo add-one estimate from `permutations` (default 9999) seeded
  xoshiro128** shuffles — replayable from `seed`, which belongs in a
  pre-registration.

```ts
import { collisionProfile, expectedMatches, pairMatchTest } from '@mindpeeker/gematria'
import { SEPHER_SEPHIROTH } from '@mindpeeker/gematria/lexicon'

collisionProfile(SEPHER_SEPHIROTH, 'he-hechrachi')
// n 160, distinct 115, collisionProbability 27/2560, 6.57 bits, 55 equal pairs, birthdayBound50 11.5
expectedMatches(SEPHER_SEPHIROTH, 'he-hechrachi') // 1.6875
pairMatchTest(
  [['אחד', 'אהבה'], ['נחש', 'משיח'], ['אל', 'לא'], ['אדם', 'מה'], ['ים', 'כל']],
  'he-hechrachi',
) // observed 5, expected 1, pValue 1/120 (exact)
```

Read the last example honestly: five hand-picked equal pairs beat random
re-pairing of *those same words*, which says the pairs were chosen for equal
values — not that the equalities mean anything.

## The `lexicon` subpath — Sepher Sephiroth

`@mindpeeker/gematria/lexicon` ships a curated, value-indexed reference
dictionary of 191 entries so lookups work out of the box:

- `SEPHER_SEPHIROTH: readonly LexiconEntry[]` — `{ word, script, value, gloss,
  source, note? }`, Hebrew (160, ascending by value), Greek (28) and English
  (3), deeply frozen.
- `defaultLexicon(cipher?)` — the words (all, or those admissible under
  `cipher`); calling it registers the corpus as the default lexicon.
- `SCRIPT_CIPHER` — the cipher each script's stored values are computed with
  (`he-hechrachi`, `gr-isopsephy`, `en-ordinal`, …).
- `FAMOUS_NUMBERS` — short notes on 31, 93, 111, 156, 418, 666, 777, 888.
- Types `LexiconEntry`, `LexiconSource`.

**Edition and sources.** The Hebrew core is transcribed from *Sepher Sephiroth
sub figurâ D* (Aleister Crowley & Allan Bennett), the special supplement to *The
Equinox* vol. I no. 8, September 1912, reading Crowley's ASCII transliteration
with the key A א, B ב, G ג, D ד, H ה, V ו, Z ז, Ch ח, T ט, Y י, K כ, L ל, M מ,
N נ, S ס, a'a ע, P פ, Tz צ, Q ק, R ר, Sh ש, Th ת. Further rows come from Mathers,
*The Kabbalah Unveiled* (1887: Shaddai = Metatron = 314, "Shiloh shall come" =
Messiah = 358), Stirling, *The Canon* (1897: Greek isopsephy, Ζευς 612 … the
numerals εις … δεκα) and Agrippa's planetary intelligences and spirits (*De
Occulta Philosophia* II.xxii). Each entry's `source` is one of
`'sepher-sephiroth' | 'mathers' | 'stirling' | 'agrippa' | 'curated'` (a widely
cited value kept from the 0.1 corpus). Every stored value is recomputed with the
package's own cipher in the test suite; two corrections came out of that: Crowley's
Hebrew Babalon is באבאלען (BABALa'aN) = 156 — the 0.1 entry בבלון = 90 is gone —
and Stirling's printed ΟΚΤΩ = 1,100 is a misprint for 1190 (his own total of
3,098 requires it).

**Licensing.** Everything is in the public domain: Crowley died in 1947 (life +
70 expired in 2018) and the 1912 edition predates 1929; Bennett died in 1923,
Mathers in 1918, Stirling in 1900, Agrippa in 1535. The modern editorial notes in
circulating e-texts are excluded; the glosses are short identifications written
for this package.

**Bundlers.** Importing the subpath registers the corpus as a side effect; the
package's `sideEffects` field names this module, so `import
'@mindpeeker/gematria/lexicon'` survives tree shaking (a test bundles it with
`Bun.build`). Calling `defaultLexicon()` is the explicit alternative.

## The `oracle` subpath — entropy bridge

`@mindpeeker/gematria/oracle` turns the deterministic engine into a divinatory
draw over any byte source, composing `@mindpeeker/oracle`. Every draw is exactly
uniform (rejection-sampled, never modulo) and carries honest entropy accounting
`{ bytesConsumed, bitsUsed, bytesFetched? }` for the draw alone; identical bytes
reproduce an identical reading.

- `drawWord(lexicon, source, { signal? })` — one word, uniformly (any lexicon
  item; no cipher involved).
- `drawByValue(lexicon, cipher, target, source, { signal?, colel?, tolerance? })`
  — uniformly among the admissible words within the window of `target`
  (`no_match` if none).
- `castGematria(lexicon, cipher, source, opts?)` — a word drawn among the
  admissible words, its full `profile`, value and reduction, its peers within the
  window (`matches`, `exact`) and `commonness` over `lexiconSize`.
- `castByValue([lexicon,] cipher, source, { mode?, min?, max?, colel?,
  tolerance?, signal? })` — draws the *number* (see below), then the words that
  share it.

`source` is any `@mindpeeker/oracle` input (bytes, an async iterable, a
`ByteSource`) or a `ByteReader` (`EntropyInput`). Every `cipher` field in a
result is the resolved canonical id.

```ts
import { castByValue, castGematria, drawByValue, drawWord } from '@mindpeeker/gematria/oracle'
import { defaultLexicon } from '@mindpeeker/gematria/lexicon'

const lexicon = defaultLexicon('he-hechrachi')
const source = crypto.getRandomValues(new Uint8Array(64))
await drawWord(lexicon, source) // { word, bytesConsumed, bitsUsed, bytesFetched }
await drawByValue(lexicon, 'he-hechrachi', 26, source) // uniform among value-26 words
await castGematria(lexicon, 'hebrew', source, { colel: true }) // word + profile + peers
await castByValue('he-hechrachi', source) // { value, words, exact, commonness, numbers, … }
```

**Lifecycle.** A draw validates every argument *before* touching the entropy
input, then reads through `byteReader(source, { signal })` and closes that reader
in `finally`, so a stream or provider opened for the draw is released whether it
resolves, throws or aborts. A `ByteReader` you pass in stays open (with a
`signal`, the draw reads through an abortable view of it), and consecutive draws
on it report per-draw accounting deltas. An already-aborted signal rejects even
a draw that needs no bytes.

**Errors.** Everything rejects with `GematriaError`: `invalid_input` for bad
arguments (including an unrecognized entropy input or a non-`AbortSignal`
signal), `unknown_cipher`, and `no_match` when the admissible lexicon or the
value window is empty. Failures of the oracle reader keep the `OracleError` as
`cause`: `aborted`, `insufficient_entropy` and `invalid_input` (e.g. a shared
reader used concurrently) keep their code; `source_error` and `closed` become
`source_error`.

### Reverse lookup / gematria oracle (entropy → number → words)

`lookup(target, lexicon, cipher)` (pure core) runs `matches` backwards: start
from a number and get back every admissible lexicon word sharing that value,
plus the same honest `commonness`. `castByValue` (the `oracle` subpath) takes
this one step further: instead of drawing a word from entropy, it draws the
*number* itself, then reports which lexicon words happen to land on it.

By default (`mode: 'lexicon'`) the draw is uniform over the distinct values of
the admissible words, so `words` is never empty. `mode: 'range'` draws uniformly
over `[min, max]` (defaults: 1 and the largest admissible value) and may land on
a value no word has. Bounds must be integers in $[0, 2^{48}]$ with
`max ≥ min` and at most $2^{48}$ values — all checked before any entropy is read.
The result carries `numberProperties` of the drawn value.

**Be honest about what this is.** The drawn number is random entropy and
nothing more; the returned words are merely whichever lexicon entries happen
to share that value — a reflection, not a message. `commonness` tells you how
cheap the coincidence is. Nothing here is evidence of anything.

## API

Every `cipher` parameter accepts a canonical `CipherId` or a friendly
`CipherAlias` (a `CipherRef`, see [Friendly aliases](#friendly-aliases)).
Everything throws `GematriaError` with a stable `code`.

**Root `@mindpeeker/gematria` — values**

- `value(text, cipher, reverse? | options?): number` — the integer value;
  `reverse` (a boolean) scores the cipher's mirror over its canonical alphabet;
  an options object `{ reverse, keepTen, namesVariant }` adds the
  cipher-specific options.
- `analyze(text, cipher, opts?): GematriaResult` — value, digital-root
  `reduced`, per-letter `byLetter`; `opts` adds `numberProperties`.
- `profile(text, opts?): GematriaProfile` — every cipher for the detected script
  (`{ script?, includeModern?, includeExtended? }`).
- `letterValues(cipher, reverse? | options?)`, `reduce(n)`, `digitRoot(n)`.
- `milui(text, variant? | { variant, namesVariant })`, `HE_NAMES`, `HE_BASE`,
  `heIndex(ch)`, `HEBREW_FINALS`.
- `detectScript(text)`, `normalizeFor(text, script)`.
- Registry: `CIPHERS`, `CIPHERS_BY_SCRIPT`, `getCipher`, `cipherFromId`,
  `resolveCipherId`, `ALIASES`, and the per-script lists `HEBREW_CIPHERS`,
  `GREEK_CIPHERS`, `ARABIC_CIPHERS`, `ENGLISH_CIPHERS`, `NUMERAL_CIPHERS`.

**Root — tools**

- Temurah: `atbash`, `albam`, `avgad`, `achbi`, `aibat`, `temurahShift(text, n)`.
- Tziruph: `tziruph(text, k, { selfPairs })`, `tziruphSquare(kind)`,
  `TZIRUPH_TABLES`, the constants `ATHBASH`, `ALBATH`, `ABGATH`, `AGDATH`,
  `ADBAG`, `AHBAD`, `AVBAH`, `AZBAV`, `ACHBAZ`, `ATBACH`, `AIBAT`, `ACHBI`,
  `ALBACH`, `AMBAL`, `ANBAM`, `ASBAN`, `AOBAS`, `APBAO`, `ATZBAP`, `AQBATZ`,
  `ARBAQ`, `ASHBAR`.
- Aiq Beker: `aiqBeker(letter)`, `chamberMates(letter, { finals })`,
  `aiqBekerSubstitute(text, position, { finals })`,
  `aiqBekerEquivalent(a, b, { finals })`, `chamberReduce(n)`, `NINE_CHAMBERS`.
- Notariqon: `notariqon(text, { mode })`, `acronym(text, { from })`.
- Numbers: `toHebrewNumeral(n, { finals, punctuation })`, `MAX_HEBREW_NUMERAL`,
  `numberProperties(n)`, `MAX_NUMBER`.

**Root — lexicons and statistics**

- `matches`, `lookup` (each with an explicit lexicon or the default),
  `equalValue`.
- `useDefaultLexicon`, `getDefaultLexicon`, `clearDefaultLexicon`,
  `createLexiconRegistry`, `admissibleWords`.
- `collisionProfile`, `expectedMatches`, `birthdayBound`, `pairMatchTest`.
- `GematriaError` and the types (`Cipher`, `CipherId`, `CipherAlias`,
  `CipherRef`, `Script`, `ValueOptions`, `AnalyzeOptions`, `GematriaResult`,
  `GematriaProfile`, `CipherValue`, `LetterBreakdown`, `LetterValue`,
  `ProfileLetter`, `ProfileOptions`, `NamesVariant`, `MiluiOptions`,
  `MiluiVariant`, `NumberProperties`, `PrimeFactor`, `NotariqonOptions`,
  `AcronymOptions`, `AiqBekerCell`, `ChamberFinals`, `ChamberOptions`,
  `TziruphTable`, `TziruphOptions`, `TziruphSelfPairs`, `TziruphSquareKind`,
  `HebrewNumeralOptions`, `Lexicon`, `LexiconWord`, `LexiconRegistry`,
  `MatchOptions`, `MatchResult`, `CollisionOptions`, `CollisionProfile`,
  `ValueBin`, `PairMatchOptions`, `PairMatchTestResult`, `PairTestMethod`,
  `GematriaErrorCode`, `GematriaErrorOptions`).

**`@mindpeeker/gematria/lexicon`** — `SEPHER_SEPHIROTH`, `defaultLexicon`,
`SCRIPT_CIPHER`, `FAMOUS_NUMBERS`; types `LexiconEntry`, `LexiconSource`.

**`@mindpeeker/gematria/oracle`** — `drawWord`, `drawByValue`, `castGematria`,
`castByValue`; types `EntropyInput`, `DrawOptions`, `MatchDrawOptions`,
`CastByValueOptions`, `DrawWordResult`, `DrawByValueResult`, `GematriaCast`,
`ValueCast`.

**Error codes** — `invalid_input`, `unknown_cipher`, `unsupported_script`,
`no_match`, and from the oracle bridge `aborted`, `insufficient_entropy`,
`source_error`.

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
  visibly a coincidence. A match at commonness 0.2 is noise. Only words the
  cipher can actually score are counted, and `collisionProfile` /
  `expectedMatches` price coincidences for the whole lexicon: in the bundled
  Hebrew corpus two random entries share a value with probability 27/2560, yet
  12 random entries already make a shared value more likely than not.
- **A list of striking equalities is not evidence.** `pairMatchTest` compares
  the agreements of your pairs with random re-pairings of the same words (the
  Bible-code critique of McKay et al.); a small p-value there only shows the
  pairs were selected for equal values.
- **The modern English ciphers are wordplay.** Hebrew and Greek letters *were*
  their numerals; Latin never had native alphabetic numerals of this kind, so
  English-letter Ordinal/Reduction and the ×6 "English"/"Sumerian" ciphers are
  recent conventions, not ancient systems. The ×6 family and the other
  calculator inventions are flagged `modern: true`; `en-ordinal` and
  `en-reduction` stay `modern: false` only for frontend parity, so
  `includeModern: false` does not remove them. `la-jewish` is a related case:
  its table is Agrippa's 1533 key, but using it for English words is a modern
  calculator convention, not Hebrew gematria itself.

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

## Behaviour changes in 0.2.0

Cipher engine and normalization (each corrects wrong math or a broken contract):

- **Reverse is defined over each cipher's canonical alphabet** *(breaking)*.
  Hebrew finals no longer score 0 under reverse (`value('שלום', 'he-hechrachi',
  true)` is 112 = Atbash, was 102); `he-gadol` reverse is the aleph↔tav mirror
  (א → 400, was 900; finals mirror like their base letter); `gr-isopsephy`
  reverse mirrors the 27 numeral letters, so σ/ς, ϝ/ϛ and ϙ/ϟ share a value
  (`λογος` → 838, was 867) and `letterValues('gr-isopsephy', true)` changed.
- **`la-agrippa` follows Agrippa's printed key** *(breaking)*: U = 200, V = 700
  (were 700/200), making it identical to `la-jewish`; label now "Agrippa
  (Latin)".
- **`Cipher` gains required `alphabet` and `fold`**, `description` is present
  on every cipher and `extended` is always a boolean.
- **Normalization**: Unicode format controls (ZWJ, ZWNJ, LRM, RLM, BOM, …) are
  stripped and no-break spaces become spaces in every script; Greek/Latin use
  NFKD (symbol letters, ligatures, fullwidth and mathematical letters now
  score); Hebrew uses NFKC (presentation forms, ℵ) and expands Yiddish
  ligatures; Arabic uses NFKD, so ؤ ئ count as و ي, and ى, ک, ی fold to ي, ك, ي
  (`موسى` is 116, was 106).
- **Script detection** recognizes Cyrillic, Armenian, Georgian, Coptic, Syriac
  and Gothic (text in these scripts was `'latin'`, so `profile()` now returns
  their numeral cipher instead of zero-valued Latin rows), Hebrew/Arabic
  presentation forms, and ignores format controls. `Script` has six new members.
- **Validation** *(breaking for invalid input)*: `normalizeFor` throws
  `unsupported_script` for an unknown script and `invalid_input` for non-strings
  (it silently used Latin rules); `detectScript` throws `invalid_input` for
  non-strings; `profile({ script })` uses an own-property lookup
  (`'constructor'` → `unsupported_script`, was a `TypeError`) and rejects
  non-boolean flags; the reverse argument of `value`/`letterValues` and
  `analyze`'s options must be a boolean / options object (a truthy string used
  to reverse silently); `digitRoot` throws `invalid_input` for non-finite input
  (`digitRoot(Infinity)` looped forever); `milui` validates its variant
  (case-insensitive; `'bogus'` silently used the default table) and rejects
  non-strings.
- **New options**: `keepTen` (`en-reduction`) and `namesVariant: 'plene'`
  (`he-milui`, `he-neelam`, `milui`). Defaults are unchanged.
- **New ciphers** (31 → 43): `gr-ordinal`, `en-tq`, `en-aq`,
  `la-elizabethan-simple`, `la-elizabethan-kaye`, `la-roman` (all extended),
  `cu-cyrillic`, `hy-numerals`, `ka-numerals`, `cop-numerals`, `syr-numerals`,
  `got-numerals`. The default `profile()` rows for Hebrew, Greek, Arabic and
  Latin text are unchanged.
- `HE_BASE` is frozen.

Tools, lexicons and the oracle bridge:

- **`achbi` implements Achbi** *(breaking)*: א↔כ, ב↔י, ג↔ט, ד↔ח, ה↔ז with ו
  fixed and ל↔ת, מ↔ש, נ↔ר, ס↔ק, ע↔צ with פ fixed (`achbi('א')` is כ, was י).
  The previous mapping (א↔י, ב↔ט, כ/ת fixed) is Ginsburg's Aibat and is now
  `aibat`.
- **Script-aware lexicons** *(breaking)*: `matches`, `lookup`, `castGematria`,
  `drawByValue` and `castByValue` only count words written in the cipher's script
  with at least one scoring letter. Foreign or empty words no longer match each
  other at value 0, `commonness` uses the admissible count (new
  `lexiconSize`), `lookup(0, …)` finds nothing, and `castByValue` can no longer
  draw 0 from a mixed lexicon.
- **Lexicons may hold `{ word, script }` objects**; the default lexicon lives in a
  registry: `getDefaultLexicon(cipher?)` filters, `clearDefaultLexicon()` resets,
  `createLexiconRegistry()` isolates. `matches`/`lookup` with a non-array where
  the lexicon belongs throw a dedicated `invalid_input`; `colel` must be a
  boolean and `tolerance` a non-negative safe integer.
- **Bundled lexicon** *(breaking data)*: 36 → 191 entries (Sepher Sephiroth,
  Mathers, Stirling, Agrippa), each with a `source`; בבלון = 90 replaced by
  Crowley's באבאלען = 156; ordered by script, then value; the header cites
  *The Equinox* I(8), 1912 (was 1909). `defaultLexicon(cipher?)` accepts a
  cipher.
- **`numberProperties`** accepts only integers in $[0, 2^{48}]$ *(breaking)*
  (above $2^{53}$ it returned wrong digit sums; large inputs ran for seconds or
  forever); `isPerfect` is always present.
- **`notariqon` / `acronym`** pick letters only, after per-script normalization
  (a trailing vowel point or punctuation was returned as the "letter"), and
  validate `mode` / `from`.
- **Temurah functions** throw `GematriaError('invalid_input')` for non-string
  text (was a raw `TypeError`).
- **Oracle bridge** *(breaking)*: every failure is a `GematriaError` — reader
  errors map to the new codes `aborted`, `insufficient_entropy`, `source_error`
  (with the `OracleError` as `cause`) instead of propagating as `OracleError`;
  arguments are validated before any entropy is read (`castByValue` range bounds
  must lie in $[0, 2^{48}]$ and span at most $2^{48}$ values; a negative `min`
  used to fail after consuming bytes, and a lexicon of a million words crashed
  the default `max`); readers the bridge opens are closed; an already-aborted
  signal always rejects; `drawByValue`/`castGematria` accept aliases and return
  the canonical id; `drawByValue` requires a non-negative target; all
  cipher-bound draws take `colel`/`tolerance` and results gain `exact`,
  `tolerance`, `lexiconSize` and `bytesFetched`; an empty admissible lexicon is
  `no_match`.
- **New API**: `aibat`, `tziruph` with the 22 table constants, `TZIRUPH_TABLES`,
  `tziruphSquare`; `chamberMates`, `aiqBekerSubstitute`, `aiqBekerEquivalent`;
  `toHebrewNumeral`; `collisionProfile`, `expectedMatches`, `birthdayBound`,
  `pairMatchTest`; `admissibleWords`, `clearDefaultLexicon`,
  `createLexiconRegistry`; `MAX_NUMBER`, `MAX_HEBREW_NUMERAL`.

## Development

```sh
bun test                       # reference-vector fixture is checked in
bun run typecheck && bun run build
```
