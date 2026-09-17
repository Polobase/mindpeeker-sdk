# Data licences

Every dataset, table and test vector in this repository that did not originate in it, with the
basis on which it is used. Code is MIT-licensed (see [`LICENSE`](../LICENSE)). This page records
provenance; it is not legal advice, and where a licence could not be confirmed it says so.

Two kinds of data are listed separately:

- **Shipped in npm packages.** Each package publishes `dist` and `src`, so data compiled into
  the source reaches users.
- **Repository only.** Test fixtures, fixture generators, firmware sketches and documentation
  assets are not in the published tarballs.

Public-domain statements below follow the reasoning recorded in the source files: works
published before 1929 are in the public domain in the United States, and works by authors who
died more than 70 years ago are in the public domain in life + 70 jurisdictions.

## Shipped in npm packages

### `@mindpeeker/gematria`

**Lexicon (`./lexicon`, 191 entries).** Each entry names its `source`; the values are
recomputed from the package's own ciphers in the test suite, and the glosses are short
identifications written for the package, not quotations. Counts by source (computed from
`SEPHER_SEPHIROTH`):

| Source | Entries | Basis |
|---|---|---|
| Aleister Crowley & Allan Bennett, *Sepher Sephiroth sub figurâ D*, special supplement to *The Equinox* I(8), September 1912 | 147 Hebrew | public domain: published 1912; Crowley died 1947, Bennett 1923. Only words and values are taken from Crowley's ASCII transliteration; the modern editorial notes in circulating e-texts are excluded |
| S. L. MacGregor Mathers, *The Kabbalah Unveiled*, 1887 | 4 Hebrew | public domain: published 1887; Mathers died 1918 |
| William Stirling, *The Canon*, 1897 | 18 Greek | public domain: published 1897; Stirling died 1900. Stirling's printed ΟΚΤΩ = 1,100 is a misprint; the lexicon ships 1190, which his own total of 3,098 requires |
| H. C. Agrippa, *De Occulta Philosophia* II.xxii (1533), planetary intelligences and spirits | 4 Hebrew | public domain; cross-checked against *Sepher Sephiroth* |
| `curated`: widely cited values kept from the 0.1 lexicon, not transcribed from one of the sources above | 18 (5 Hebrew, 10 Greek, 3 Latin) | single words and their arithmetic, which is recomputed; these rows were not re-checked against a primary page in the 0.2.0 work |

**Cipher tables (43 ciphers).** Letter-to-number assignments of historical numeral systems
(Hebrew, Greek Milesian, Arabic Abjad, Church Slavonic Cyrillic, Armenian, Georgian, Coptic,
Syriac, Gothic) and of published cipher schemes, each cited in the cipher's JSDoc. `la-agrippa`
follows Agrippa's printed key in *De Occulta Philosophia* II.xx (public domain; checked against
the ark-db library copy of the 1651 English translation, p. 23). Modern English ciphers
reproduce the letter values used by public online calculators. Only the value tables are
reproduced, no text.

### `@mindpeeker/oracle`

Identity and structure data only: names, numbers, orders and probabilities. No meanings,
commentaries, verse texts or answer texts are shipped.

| Data | Source | Basis |
|---|---|---|
| Geomantic figures, their planet, sign and node attributions, and the Golden Dawn house map | Crowley, *Liber XCVI, A Handbook of Geomancy*, *The Equinox* I(2), 1909; cross-checked against Skinner (1980) | public domain (1909); Skinner is cited, not copied |
| I Ching: King Wen order, trigrams, Chinese titles and pinyin | traditional | facts |
| I Ching English hexagram titles | Wilhelm & Baynes, *The I Ching or Book of Changes* (1950) | short titles only; no translation text |
| I Ching Legge names (`LEGGE_NAMES`, 11 hexagrams) | James Legge, *The I Ching* (1899) | public domain (1899; Legge died 1897) |
| I Ching and trigram glyphs | Unicode Yijing Hexagram Symbols and Miscellaneous Symbols blocks | Unicode character data |
| Tarot card titles, Major Arcana numbering and the `celticCrossWaite` deal order | A. E. Waite, *The Pictorial Key to the Tarot* (1911) | public domain (1911) |
| Younger Futhark and Anglo-Saxon futhorc rows | the Norwegian and Old English rune poems as edited by Bruce Dickins, *Runic and Heroic Poems of the Old Teutonic Peoples* (1915) | rune names and order from medieval poems; the 1915 edition is public domain in the US. No translation text |
| Elder Futhark order, names and ætt names; the blank rune (flagged `modern`) | traditional; the blank rune follows Blum (1982) | facts; no text |
| Ifá: the sixteen principal odu, their marks and rank orders | William Bascom, *Ifa Divination* (1969), Tables 1 and 3; marks agree with Frisvold (2012) | names and structure as ethnographic facts; no text |
| Sixteen cowries: names by count | chapter titles of Bascom, *Sixteen Cowries* (1980) | names only |
| Tibetan Mo: die syllables and their numeric equivalents | Mipham, *Mo: Tibetan Divination System*, tr. Goldberg & Dakpa (1990) | structure only; the translated answer texts are not shipped |
| Homer oracle: 216 dice-indexed entries | PGM VII.1–148 (Betz 1986 translation cited) | index structure only; no verse text |
| Kau cim set sizes and jiaobei block weights | temple practice (sources in the JSDoc) | modeled; no text |
| Astragalus face weights 1:4:4:1 | commonly attributed to Hagström (1932); not verified against a primary source | modeled |

### Other packages

| Package | Data | Source | Basis |
|---|---|---|---|
| `vdf` | the RSA-2048 modulus (`RSA2048`) | RSA Laboratories, RSA Factoring Challenge | a published challenge number |
| `entropy` | pinned drand chain parameters (`DRAND_CHAINS`: hash, genesis, period, scheme) | the public drand network | public protocol parameters |
| `entropy` | TrueRNGpro mode table (`TRUERNG_MODES`) and OneRNG commands (`ONERNG_COMMANDS`) | ubld.it and Moonbase Otago device documentation | baud rates and command strings needed to operate the devices |
| `coincidence` | `PLAYING_CARD_SCHEME` | R. A. Fisher, "A Method of Scoring Coincidences in Tests with Playing Cards", *Proceedings of the Society for Psychical Research* 34 (1924), pp. 181–185 | public domain in the US (1924); the scores are recomputed from first principles |
| `judging` | `ESP_RUN` (25 trials, 5 choices) and `PK_RUN` (24 trials, 6 choices) | Rhine-era run conventions | facts |
| `ephemeris` | series coefficients: Meeus ch. 22 nutation terms, ch. 25 solar terms, the lunar Tables 47.A and 47.B, ch. 49 phase corrections; the IAU 1982 GMST expression; the USNO equation of the equinoxes; Espenak & Meeus ΔT polynomials | J. Meeus, *Astronomical Algorithms*, 2nd ed. (1998); USNO; F. Espenak & J. Meeus, NASA TP-2006-214141 | numerical constants of published astronomical models; the lunar tables were checked term by term against ERFA's `moon98.c` and a Go port of Meeus |
| `psi` | `GCP_BASKET_FILTER` (keep 55–145), `PEAR_RUN_TRIALS` (50), `PEAR_BITS_PER_TRIAL` (200) | Global Consciousness Project data documentation; PEAR protocol descriptions | protocol parameters |
| `scan` | AetherOne parity parameters (race subset bounds 120 and 5000, `GV_AUTO_MODE_THRESHOLD` 1400) | read from the AetherOnePi and AetherOnePy sources; the scan README's fidelity table lists each one | parameters of a reimplemented procedure |

`rate`, `negentropy`, `flow`, `field`, `ledger` and `visualizer` ship no third-party data.

## Repository only

### Third-party test vectors

| Package | Fixture | Source | Licence |
|---|---|---|---|
| `ledger` | `test/fixtures/jcs-cyberphone.json` | [cyberphone/json-canonicalization](https://github.com/cyberphone/json-canonicalization/tree/master/testdata) test data (named in RFC 8785) | Apache-2.0, copyright 2018 Anders Rundgren (recorded in the fixture) |
| `ledger` | `test/fixtures/merkle-probes.json` | [transparency-dev/merkle](https://github.com/transparency-dev/merkle/tree/main/testdata) inclusion and consistency probes and reference roots | Apache-2.0, copyright Google LLC (recorded in the fixture) |
| `ledger` | `test/fixtures/notes.json`, Go section | `golang.org/x/mod/sumdb/note` test keys and signatures | BSD-3-Clause, The Go Authors |
| `ledger` | `test/fixtures/notes.json`, C2SP section | the example in [c2sp.org/signed-note](https://c2sp.org/signed-note) | **not confirmed**: included with source attribution only, because no licence file was found in the C2SP repository |
| `ledger` | `test/fixtures/notes.json`, sumdb section | a `sum.golang.org` checkpoint captured 2026-09-17, verified with the log's public key | public transparency-log output |
| `ledger` | RFC examples in tests | RFC 8785 §3.2.2–3.2.4 and Appendix B; RFC 9162 §2.1.5 | cited from the IETF specifications |
| `entropy` | `test/fixtures/beacons/`: NIST pulses 2/1921596, 2/1945334, 2/1945335; NQSN pulse 1/593768; Inmetro pulse 2/957117; NIST and NQSN certificates | captured live from the public beacon APIs to pin the byte layout | public beacon output published for anyone to fetch; no separate licence recorded |
| `oracle` | the *Liber XCVI* worked chart (bytes `CA 34` → Judge Populus, 74 points → Part of Fortune II) in `test/systems/geomancy/chart.test.ts` | Crowley, *The Equinox* I(2), 1909, ch. II–III | public domain (1909) |
| `gematria` | `test/fixtures/reference-vectors.json` | hand-authored values from cited numeral tables (Hebrew per torahcalc.com charts, Greek Milesian, English ordinal) | numbers computed from the tables; no copied text |

### Computed fixtures

All other fixtures are numbers produced by the repository's own generator scripts in
`packages/<name>/scripts/fixtures/`, which record their interpreter and library versions. They
contain no third-party data:

| Package | Computed with |
|---|---|
| `negentropy` | scipy, numpy, mpmath, arch; exact enumeration with Python fractions |
| `flow` | PyInform, numpy |
| `psi` | scipy, mpmath; the basket CSV files are synthetic, and their expected parse comes from Python's `csv` module (no GCP data) |
| `field` | scipy, numpy, pygeohash; spatstat formulas read from its R source and evaluated in Python |
| `scan` | scipy, statsmodels, exact rationals, hashlib |
| `vdf` | Python standard library (`hashlib`) |
| `rate` | scipy |
| `oracle` | scipy, Python standard library |
| `coincidence` | exact fractions, mpmath |
| `judging` | integer arithmetic, fractions, mpmath, SciPy |
| `ledger` | hashlib, pyca/cryptography (verdicts only); the psi recording is written by `@mindpeeker/psi` itself |
| `ephemeris` | astropy, pyerfa (ERFA), PyMeeus, convertdate, jplephem; ΔT reference values are IERS observations as distributed with astropy |

**JPL DE440s.** The ephemeris generator reads the JPL DE440s kernel from a local path
(`EPHEMERIS_BSP`) to compute Moon and phase reference values. The kernel is not checked in and
not shipped; only the resulting numbers are.

### Other repository assets

- `packages/entropy/docs/noise/*.png` and `packages/entropy/docs/quality.json` are generated
  from the maintainers' own measurements of each source.
- `packages/entropy/firmware/` holds serial streamer sketches; they are not published to npm.
  The ESP32 sketch follows the AetherOnePi reference firmware. The licence of the AetherOnePi
  project was not recorded here; check it before redistributing that sketch.
