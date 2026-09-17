/**
 * Greek rows of the bundled lexicon, ascending by Milesian isopsephy value.
 * Rows sourced `'stirling'` are William Stirling's isopsephy examples (*The
 * Canon*, 1897) — Ζευς 612, Απολλων 1061, the numerals εις … δεκα; Stirling
 * prints ΟΚΤΩ as 1,100, a misprint: its letters give 1190, and so does his own
 * total of 3,098 for ΤΕΤΡΑΣ … ΕΝΝΕΑ. Every value is recomputed with `gr-isopsephy` in the test suite.
 */

import type { LexiconRow } from './rows.js'

export const GREEK_ROWS: readonly LexiconRow[] = [
  ['Δεκα', 30, 'ten', 'stirling'],
  ['Εξ', 65, 'six', 'stirling'],
  ['Αγαπη', 93, 'Agape — Love', 'curated', 'Agape = Thelema = 93'],
  ['Θελημα', 93, 'Thelema — Will', 'curated'],
  ['Αμην', 99, 'Amen', 'curated'],
  ['Εννεα', 111, 'nine', 'stirling'],
  ['Βαβαλον', 156, 'Babalon', 'curated', '156'],
  ['Εις', 215, 'one', 'stirling'],
  ['Ναος', 321, 'naos — a temple', 'stirling', '= Καλος (beautiful) = 321'],
  ['Καλος', 321, 'beautiful', 'stirling', '= Ναος (temple) = 321'],
  ['Ερμης', 353, 'Hermes', 'curated'],
  ['Αβραξας', 365, 'Abraxas', 'curated', '365, days of the year'],
  ['Λογος', 373, 'Logos — the Word', 'curated'],
  ['Επτα', 386, 'seven', 'stirling'],
  ['Πολις', 390, 'city (the Bride)', 'stirling'],
  ['Πεντε', 440, 'five', 'stirling'],
  ['Μητηρ', 456, 'Meter — Mother', 'curated'],
  ['Δυο', 474, 'two', 'stirling'],
  ['Ρομβος', 482, 'rhombus', 'stirling'],
  ['Ζευς', 612, 'Zeus', 'stirling'],
  ['Τρεις', 615, 'three', 'stirling'],
  ['Σοφια', 781, 'Sophia — Wisdom', 'curated'],
  ['Ιησους', 888, 'Iesous — Jesus', 'stirling', '888'],
  ['Τετρας', 906, 'four (tetrad)', 'stirling'],
  ['Απολλων', 1061, 'Apollo', 'stirling'],
  ['Ωαννης', 1109, 'Oannes', 'stirling'],
  ['Οκτω', 1190, 'eight', 'stirling', 'Stirling prints 1,100; his total 3,098 needs 1190'],
  ['Χριστος', 1480, 'Christos — the Anointed', 'curated'],
]
