# 0007: Every gematria cipher has a canonical alphabet and a fold

- Status: accepted
- Date: 2026-09-17
- Deciders: Manuel Haller Polo (maintainer)

## Context and problem statement

`@mindpeeker/gematria` computes exact integer values of words under historical and modern
ciphers, and `value(text, cipher, true)` computes the **reverse** of a cipher. In 0.1.0 reverse
mirrored each cipher's glyph table, which contains variant glyphs, final forms and numeral
signs, not the traditional letter order. The results were wrong in ways the audit reproduced:

- Hebrew final forms (ך ם ן ף ץ) scored 0 under reverse, so `value('שלום', 'he-hechrachi', true)`
  was 102, while the Atbash substitution of the same word, which is the reverse by definition,
  is 112;
- under `he-gadol`, reverse mirrored the 27-entry table and gave aleph 900 and tav 6;
- Greek variants of one numeral (σ/ς, ϝ/ϛ, ϙ/ϟ) received different reversed values;
- Arabic text was normalized with NFC, so hamza-seated letters (ؤ ئ) scored 0 and alef maqsura
  (ى) was not in the table;
- `la-agrippa` had U and V swapped relative to Agrippa's printed key.

The underlying problem: a cipher had no explicit notion of "the letters, in order" separate
from "every glyph that may appear in text".

## Decision drivers

- Reverse must be a well-defined operation for every cipher, and reversing twice must give the
  forward cipher.
- Glyph variants of one letter must always score the same, forward and reversed.
- Values must match the primary tables.

## Considered options

1. Special-case reverse per script.
2. Keep separate reverse cipher ids with hand-written tables.
3. **Give every cipher an explicit canonical `alphabet` (one glyph per letter, in traditional
   order) and a `fold(ch)` that maps variants, final forms and presentation forms to their
   letter; define reverse over the canonical alphabet.**

## Decision outcome

Chosen option 3.

- One builder defines every cipher with `alphabet`, `fold` and a `description`. Reverse is
  defined as: letter $i$ of an alphabet of $n$ letters takes the forward value of letter
  $n - 1 - i$. Characters fold to their letter before lookup, so variants share values in both
  directions.
- Normalization is per script: Unicode format controls are stripped everywhere; Hebrew uses
  NFKC (and expands Yiddish ligatures); Greek, Latin and Arabic use NFKD and drop combining
  marks, so hamza seats score as their seat letter and ى, ک, ی fold to ي, ك, ي.
- `la-agrippa` follows Agrippa's printed key in *De Occulta Philosophia* II.xx (U = 200,
  J = 600, V = 700, W = 900), checked against the ark-db library copy of the 1651 English
  translation, p. 23. That makes it table-identical to `la-jewish`; both ids are kept and the
  README explains the lineage.
- A generic test checks every cipher's invariants, including that reversing twice is the
  identity.

With this rule, `value('שלום', 'he-hechrachi', true)` is 112, equal to the value of its Atbash
substitution; `value('λογος', 'gr-isopsephy', true)` is 838; and `value('את', 'he-gadol', true)`
is 401 (aleph and tav exchange 1 and 400).

### Consequences

- Good: reverse values are defined by one formula for all 43 ciphers, including the ones added
  in 0.2.0.
- Good: new scripts need only an alphabet, a fold and a value table.
- Bad: reversed values change for Hebrew, `he-gadol` and Greek, and forward values change for
  Arabic words with hamza seats or alef maqsura; `la-agrippa` values change for U and V.
- Bad: the `Cipher` interface gains required fields (`alphabet`, `fold`, `description`), which
  breaks objects that implement it by hand.

## More information

- Implementation: [`df74544`](https://github.com/Polobase/mindpeeker-sdk/commit/df74544bfeed75225b96c349285a531776ef3b32);
  the earlier step that made reverse a parameter instead of separate cipher ids:
  [`facff26`](https://github.com/Polobase/mindpeeker-sdk/commit/facff26da18e4c76e9e534146e33084d4da630c9).
- The gematria README sections on alphabet and fold, normalization, and "Behaviour changes in
  0.2.0".
