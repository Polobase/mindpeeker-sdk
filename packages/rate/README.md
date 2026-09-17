# @mindpeeker/rate

Malcolm Rae's **base-44 radionic angular encoding**, made reproducible.

A radionic *rate* is a short tuple of digits. On Rae's Magneto-Geometric cards
each digit is the **angle of a radial line** on one of a stack of concentric
circles. This package turns that pictorial code into precise, testable
mathematics: rate parsing, the digit→angle map, directional (circular)
statistics over the resulting phase vectors, pure card geometry + SVG, base
conversion between dial systems, and deterministic stream modulation.

Zero dependencies, browser-safe (only `Math`, typed arrays, `atan2`), ESM.
Every `@mindpeeker/entropy` provider works as a byte source *structurally* — the
packages share a shape, not code:

```ts
interface ByteSource {
  readonly name: string
  stream(opts?: { signal?: AbortSignal; chunkBytes?: number }): AsyncIterable<Uint8Array>
}
```

> **Epistemic framing, up front.** The geometry and signal processing here are
> ordinary, verifiable mathematics — angles, resultant vectors, XOR, phasors.
> The *radionic* claim attached to these patterns — that a card "imprints" a
> remedy or acts at a distance — is outside established science and is **not**
> asserted, tested, or supported by this package. What this code does, and all
> it does, is make Rae's encoding **exact and reproducible**: same rate in →
> same angles, same card, same modulated stream out.

## Quick start

```ts
import {
  parseRate, formatRate, ratePhases,
  cardGeometry, cardSvg,
  circularMean, resultantLength, circularVariance,
  dialToBase44, rateMask, xorImprint,
} from '@mindpeeker/rate'

const rate = parseRate('12-33-7')           // { digits: [12, 33, 7], base: 44 }
const phases = ratePhases(rate)             // Float64Array of ring angles (rad)

const R = resultantLength(phases)           // how aligned the ring angles are, [0,1]
const mean = circularMean(phases)           // mean direction, [0, 2π)

const geo = cardGeometry(rate)              // pure {rings:[{radius,angleRad}], base}
const svg = cardSvg(geo, { size: 256 })     // standalone SVG string, no DOM

const { rate: r44, maxErrorRad } = dialToBase44([1, 1, 1, 4, 8]) // base 10 → 44

// Deterministic, reversible "imprint" of a byte stream by a rate:
for await (const chunk of xorImprint(bytes, rate)) { /* ... */ }
```

## History: Rae, base-44, and the Magneto-Geometric card

Malcolm Rae moved into radionics and homoeopathy and founded Magneto-Geometric
Applications (MGA). Practitioner web pages describe him as a British electronic
engineer, give his dates as 1913–1979 and date his work from the 1950s; the printed
sources we checked give no dates, place his new instrument and
potency-simulation concepts in the 1960s, and put most of his and David
Tansley's work in the UK between about 1965 and 1985. He worked from the older
**base-10 dial instruments** of the Delawarr and Copen schools: boxes of dials,
commonly labelled 1–10, whose settings ("rates") were meant to identify a
condition or remedy. According to the same practitioner pages, Rae asked a
dowsing question: *what is the minimum number of dial calibrations needed to
express, without interpolation, every concept in the human entity?* His answer,
and the name of the system, was **44**, and he judged the base-44 instrument
"more effective and certain in its results than any 10 based instrument". No
printed source we found mentions the number 44 in connection with Rae; treat the
base-44 rationale as web-sourced.

Dissatisfied with error-prone dial setting, Rae then replaced the dials
entirely with **Magneto-Geometric cards**: a circular diagram of concentric
circles, each carrying a *partial radius* (a short radial line) at a specific
angle. The set of angles is the rate. A printed history counts about 24,000
rates in his card system. A "Simulator" holds the card to imprint water or
pills; an "Interrupter" pulses it for distant treatment. According to Wired
Alchemy, Yvon Combe later transcribed card patterns into base-10, **base-44**
and "base-336" rate books. The same page and a 2024 practitioner design document
describe base-336 rates as sequences of the digits 1–9 (for example `2 2 9 1 4`),
so "336" is not a radix: `convertBase(rate, 336)` does not produce a Combe
base-336 rate, and this package does not model that system.

"Printed sources" here means a search of the maintainers' ark-db document
library (about 88,000 books and documents): ark-db library, *Radionics - Science
of The Future*, p. 1 (1960s concepts); ark-db library, *Swimming Through The
Ether* (Franks, 2000), pp. 4 and 16 (about 24,000 card rates; work c. 1965–1985;
MGA founded by Rae); ark-db library, *introtoorgonite4plus* (a DIY instrument
manual), p. 39 (dials marked 1 to 10); ark-db library, *Secrets in the
Fields* (Silva, 2002), p. 224 ("concentric rings and radii").

### Verified vs modeled

Primary technical sources on the exact card geometry are thin (Rae's own papers
are largely out of print; the surviving material is practitioner web pages and
scanned booklets). This table separates what the sources actually say from what
this package *models* as a clean, configurable parameterisation.

| Claim | Status | Source |
|---|---|---|
| Rae founded Magneto-Geometric Applications (MGA); his card system holds about 24,000 rates | **Verified** (printed) | ark-db library, *Swimming Through The Ether*, pp. 4 and 16; radionics.co.uk (MGA-Rae) |
| Rae's dates 1913–1979; electronic engineer; MGA work from the 1950s | **Web-sourced only** — printed sources give no dates and place his instrument concepts in the 1960s | radionics.co.uk; wiredalchemy.com; ark-db library, *Radionics - Science of The Future*, p. 1 |
| Base **44** chosen as "minimum calibrations to express every concept in the human entity"; held superior to base-10 | **Web-sourced only** — practitioner pages quote Rae; no printed source we found mentions 44 | radionics.co.uk; wiredalchemy.com |
| Predecessor dial instruments (Delawarr, Copen) use **base-10** dials, commonly labelled 1–10 | **Verified** (base 10: web and rate books; 1–10 labels: a printed DIY manual) | wiredalchemy.com; frontend rate books (`delawarr`, `copenHomeo`, `copenOrgan` = base-10); ark-db library, *introtoorgonite4plus*, p. 39 |
| Cards are "concentric circles containing partial radii of equal length"; the pattern is the **angles** of those radii | **Verified** | radionics.co.uk (MGA-Rae); ark-db library, *Secrets in the Fields*, p. 224 |
| Angular resolution "one degree of arc"; lines measured from 12 o'clock / north | **Web-sourced only** (qualitative) | radionics.co.uk; wiredalchemy card comments |
| Combe converted card patterns to base-10 / **base-44** / "base-336" rate books; base-336 rates are digit sequences 1–9, not base-336 numbers | **Web-sourced only** | wiredalchemy.com; psychotronics.org design document (2024); frontend `combe` book (multi-base) |
| Real base-44 rate books label digits **1..44** (one-based), ~5 digits/rate | **Empirical** (65,311 of 65,500 Combe base-44 tokens land in 1..44) | frontend `rate-index` (Combe) |
| Digit→angle is exactly $\theta_d = d\cdot\tfrac{2\pi}{44}$ | **Modeled** — a clean $\mathbb{Z}_{44}\to S^1$ map consistent with "equal-angle radial lines". A 2024 practitioner design document states 360/44 ≈ 8.18° per base-44 step and 36° per base-10 step; no source attributes a per-digit formula to Rae | this package; psychotronics.org design document (2024) |
| **One ring per digit**, concentric inner→outer; ring radii spacing | **Modeled** — sources confirm concentric rings + radial lines but not the digit↔ring assignment or spacing. The 2024 design document also says base-44 rates are written in non-decreasing order; `parseRate` does not enforce an order | this package |
| `phaseModulate` / `rateMask` / `xorImprint` DSP | **Modeled / esoteric protocol** — invented here, reproducible and reversible, no efficacy claim | this package |

Where the sources are silent, the model is deliberately **parameterised**: the
base defaults to 44 but every function takes it explicitly, so base-10 dial rates
use the same functions with `base: 10`. Combe's "base-336" digit sequences are not
modelled (see above).

Sources:
[radionics.co.uk — MGA-Rae information](http://www.radionics.co.uk/index.php/radionic-instruments/mga-rae-information),
[Wired Alchemy — The 10, the 44, and the 336](https://wiredalchemy.com/radionic-rates-the-10-the-44-and-the-336/),
[Wired Alchemy — Malcolm Rae MGA cards](https://wiredalchemy.com/radionic-rates-dials/malcolm-rae-cards/),
[Wired Alchemy — Rates and Dials](https://wiredalchemy.com/radionic-rates-dials/),
[psychotronics.org — Radionics Basic Instrument Design 101, v6 (2024)](https://www.psychotronics.org/pub/lib/2024-02-16-radionics-basic-instrument-design-v6.pdf);
printed sources from the ark-db library as listed in the history above.

## The math

### Rate

A `Rate` is `{ digits: number[], base: number }` with each digit in
$[0, \mathrm{base})$. The canonical form is **0-based** so the digit→angle map is
a group homomorphism $\mathbb{Z}_b \to S^1$. Rae's rate books print **1..44**
labels; `parseRate(s, { oneBased: true })` and `formatRate(r, { oneBased: true })`
bridge the two. `parseRate` accepts digits separated by `-` or by `.` (one
kind of separator per rate); spaces are not accepted. A book rate printed as
`01 04 19 27 28` (a real Combe rate) is therefore parsed as
`parseRate('01-04-19-27-28', { oneBased: true })`, and
`formatRate(rate, { oneBased: true, pad: true, separator: ' ' })` prints it back
as `01 04 19 27 28`. Base-10 dial labels 1–10 work the same way:
`parseRate('1-4-10', { base: 10, oneBased: true })` gives digits `[0, 3, 9]`.

### Digit → angle

$$\theta_d = d \cdot \frac{2\pi}{b}, \qquad d \in \{0,\dots,b-1\}$$

For base 44 the step is $\tfrac{2\pi}{44} = \tfrac{\pi}{22} \approx 8.18°$ and,
for example, digit 11 sits at $\theta_{11} = \tfrac{\pi}{2}$ in exact arithmetic.
In floating point, `digitToAngle(11, 44)` is within 1 ulp of `Math.PI / 2` (one
representable double below it), so compare angles with a tolerance, not `===`.
`ratePhases(rate)` returns the whole ring-angle vector as a `Float64Array`.

### Directional statistics

The angles of a rate live on a circle, so Euclidean means are wrong; use
directional statistics (Mardia & Jupp, *Directional Statistics*, 2000).

The **mean resultant length**

$$\bar R = \frac{1}{n}\left|\sum_{j=1}^{n} e^{i\theta_j}\right| \in [0, 1]$$

measures concentration: $\bar R = 1$ iff all angles coincide, $\bar R = 0$ for a
perfectly balanced spread. The **circular mean** is
$\bar\theta = \mathrm{atan2}(\sum_j \sin\theta_j,\ \sum_j \cos\theta_j)$
(returned in $[0, 2\pi)$; undefined as $\bar R \to 0$), and the **circular
variance** is $V = 1 - \bar R$. `circularVariance` matches
`scipy.stats.circvar` on its full-circle range — the tests cross-check against
scipy fixtures.

### Base conversion

`dialToBase44(dial)` / `convertBase(rate, targetBase)` re-express a rate by
snapping each digit's angle to the nearest step of the target base:

$$d' = \Big\lfloor d\cdot\tfrac{b_\text{tgt}}{b_\text{src}} + \tfrac12\Big\rfloor
      \bmod b_\text{tgt}$$

and report `maxErrorRad`, the largest angular move. Because each digit rounds to
the nearest of $b_\text{tgt}$ equally-spaced steps, this is bounded by half a
target step, $\tfrac{\pi}{b_\text{tgt}}$ — so refining base-10 → base-44 is
near-lossless, while coarsening loses resolution (and the report tells you
exactly how much).

### Card geometry & SVG

`cardGeometry(rate, { innerRadius, outerRadius, ringGap })` returns one
`{ radius, angleRad }` per digit, concentric, **as pure data** — hand it to a
WebGL/Canvas visualiser. `cardSvg(geometry, opts)` builds a standalone SVG
string (no DOM) for printing or snapshot diffing. The angle convention matches
practitioner cards: $\theta = 0$ points **up** (12 o'clock) and increases
clockwise, i.e. $x = c + r\sin\theta,\ y = c - r\cos\theta$.

### Stream modulation (esoteric protocol — labeled as such)

Three deterministic maps from a byte stream + rate. They are ordinary DSP; the
"imprint" framing is Rae's esoteric protocol, reproduced, not endorsed.

- **`phaseModulate(stream, rate)`** → `Float64Array` phases. Each byte $b$
  becomes the argument of the unit phasor $e^{i 2\pi b/256}$ rotated by the ring
  phase for its position, cycling through rings one byte at a time:
  $\phi_j = (2\pi b_j/256 + \theta_{j \bmod n}) \bmod 2\pi$.
- **`rateMask(rate, length)`** → deterministic keystream,
  $\mathrm{mask}[i] = \mathrm{round}(\theta(i \bmod r)\cdot\tfrac{256}{2\pi})
  \bmod 256$, periodic with period $r$ = digit count. **Not** a CSPRNG; carries
  no entropy of its own; never a key.
- **`xorImprint(stream, rate)`** → XOR the stream with the cyclic mask. XOR by a
  fixed byte is a bijection on $\{0,\dots,255\}$, so this is **entropy-preserving**
  — it neither adds nor removes information, and imprinting **twice** with the
  same rate is the identity. It provides **no confidentiality**.

All async generators are deterministic (same bytes + rate → same output) and
support an `AbortSignal`.

## Caveats

- **No efficacy claim.** See the framing box above. This is an encoder, a
  geometry engine, and a DSP toolkit — nothing more.
- **Circular mean is undefined at zero resultant.** For (near-)balanced angle
  sets `circularMean` still returns `atan2(0,0)=0`; gate on `resultantLength`.
- **`xorImprint`/`rateMask` are not cryptography.** The mask is a fixed,
  public function of the rate. Do not use it as a pad or key.
- **Modeled geometry.** The digit↔ring↔angle assignment is this package's clean
  model (see the verified-vs-modeled table), configurable via `base` and the
  card options. It reproduces the *shape* of Rae's cards; it is not a scan of a
  specific original card set.
- **One-based labels.** Rate books use 1..44 and base-10 dials are commonly
  labelled 1–10; pass `oneBased: true` to `parseRate`/`formatRate` to work in
  printed labels while storing 0-based digits internally.
- **Separators.** `parseRate` accepts `-` or `.` between digits, not spaces;
  replace the spaces of a printed rate with `-` before parsing.

## Testing

`bun test` covers parse/format round-trips (incl. edge digits 0 and 43),
angle values (digit 11 → $\pi/2$ within floating-point tolerance), directional statistics against
`scipy.stats.circmean`/`circvar` fixtures, dial-conversion error bounds,
modulation determinism, `xorImprint` invertibility and mask periodicity, an
exact SVG snapshot, and a browser-safety guard. Fixtures under `test/fixtures/`
are regenerated (never at test time) by the uv inline script
`scripts/fixtures/generate.py`.
