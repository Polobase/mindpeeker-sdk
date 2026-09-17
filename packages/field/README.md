# @mindpeeker/field

Spatial negentropy — turn an entropy stream into a 2-D point field and ask
whether it holds any **order**.

Where [`@mindpeeker/negentropy`](../negentropy) looks for structure in a time
series, `field` looks for it in *space*: it draws unbiased points from an
entropy source and tests them against a **complete spatial randomness (CSR)**
null — the sampling and null-model core of a Randonautica-style attractor /
void engine. A field drawn from a good RNG *is* CSR, so an "attractor" is the
expected chance clustering of a random field. The package gives each such
flag two numbers and says which is which: a single-point tail (how unusual one
pre-chosen neighbourhood would be) and a calibrated whole-field Monte-Carlo p
(how unusual the most extreme neighbourhood of this field is). The geometry is
asserted; the intention hypothesis is not.

Zero runtime dependencies beyond the SDK, browser-safe. Depends on
`@mindpeeker/oracle` (exact point sampling) and `@mindpeeker/negentropy`
(numerics). Geographic helpers live behind the `@mindpeeker/field/geo` subpath.

## Sampling

```ts
import { sampleField } from '@mindpeeker/field'
import { anu } from '@mindpeeker/entropy/providers' // any provider works structurally

const region = { kind: 'disk', radius: 3000 } as const
const { points, accounting } = await sampleField(anu({ apiKey }), 1000, region)
// points: area-uniform in the region; accounting: bytes/bits the draw spent
```

Regions are `{ kind: 'rect', width, height }` (points in $[0,w]\times[0,h]$)
or `{ kind: 'disk', radius }` (centred at the origin). Each point costs two
32-bit coordinates (8 bytes, MSB-first): rect $x = uW$, $y = vH$; disk
$r = R\sqrt u$, $\theta = 2\pi v$ — no modulo or rounding bias, deterministic
in the input bytes.

**Inputs and lifecycle.** Every sampling function accepts any oracle input (a
recorded `Uint8Array` batch, an async byte stream, a `ByteSource` provider)
or an existing oracle `ByteReader`. A reader the function creates is closed
before it returns, so a live provider's socket or device session is released
on success, error and abort alike. A `ByteReader` you pass stays open and
advances — pass one reader to consecutive calls to keep their bytes disjoint:

```ts
import { byteReader } from '@mindpeeker/oracle'
import { fieldSignificance, sampleField } from '@mindpeeker/field'

const reader = byteReader(provider)
const { points } = await sampleField(reader, 400, region)
const significance = await fieldSignificance(reader, points, region, { runs: 999 })
await reader.close()
```

## Attractors and voids

```ts
import { attractors, fieldSignificance } from '@mindpeeker/field'

const { attractor, void: voidSpot, radius } = attractors(points, region)
// attractor.neighbours, .expected, .power, .z, .pSingle — single-point statistics

const { attractor: a, void: v } = await fieldSignificance(reader, points, region, { runs: 999 })
// a.p, v.p — calibrated whole-field p-values for the max / min count
```

`attractors` scores every point by the number $k_i$ of other points within
`radius` (default: the radius whose interior CSR expectation
$(n-1)\pi r^2/A$ equals `expectedNeighbours`, default 4) and returns the
maximum (attractor) and minimum (void) count; ties are broken by
lexicographic coordinates, so the result never depends on point order. Each
hotspot carries:

| field | definition |
| --- | --- |
| `expected` | $\mu_i = (n-1)\,\lvert B(p_i, r)\cap W\rvert/A$ — the neighbourhood disk **clipped by the region** (exact circle–rectangle and lens areas) |
| `power` | $k_i/\mu_i$ |
| `z` | $(k_i-\mu_i)/\sqrt{\mu_i}$ |
| `pSingle` (= `pValue`) | exact tail of Binomial$(n-1,\ \lvert B\cap W\rvert/A)$: $P(X\ge k)$ for the attractor, $P(X\le k)$ for the void |

`pSingle` is the p of a neighbourhood chosen **before** looking. Applied to
the most extreme of n dependent counts it is not a p-value for the field: in
our CSR simulations (rect 100×80, default radius) the attractor's `pSingle`
was ≤ 0.05 in 58 % of fields at n = 60 and in 100 % at n = 300.

`fieldSignificance` answers the honest question — is this field's densest
(sparsest) neighbourhood unusual for a random field of the same size? It
draws `runs` CSR fields from the entropy source with the same sampler,
computes $T_{max} = \max_i k_i$ and $T_{min} = \min_i k_i$ for each, and
returns $p = (1 + \#\{\text{simulated at least as extreme}\})/(1+\text{runs})$
with `rank`, `runs` and `accounting`. The test is exact (Besag & Diggle 1977)
and, with discrete counts, conservative: under CSR the attractor p was
≤ 0.05 in 4.7 % of 300 fields at n = 300 and the void p in none (the sparsest
point of a random field almost always has zero neighbours).

### Randonautica / libAttract parity

libAttract (the engine behind Randonautica, `newtonlib/libAttract/Export/export_h.h`)
reports per attractor:

| libAttract field | here | note |
| --- | --- | --- |
| `radiusM` | `radius` | fixed per call here; libAttract grows a peak radius |
| `n` | `neighbours` | libAttract counts around a peak centre, not a data point |
| `mean` | `expected` | edge-corrected here |
| `power` | `power` | libAttract's void "power" is the inverse |
| `z_score` | `z` | Poisson standard score |
| `probability_single` | `pSingle` | exact binomial here |
| `significance`, `probability` | `fieldSignificance(...).attractor.p` | libAttract's is a z-score of the whole calculation; ours is a calibrated Monte-Carlo p |
| `integral_score`, `rarity` (tiers from z = 3.0 to 7.0) | — | not implemented; tiers are labels, not tests |

## Summary statistics

```ts
import { clarkEvans, quadratTest, ripleyK, ripleyL } from '@mindpeeker/field'

clarkEvans(points, region, { correction: 'donnelly' }) // R, z, pValue
ripleyK(points, region, [50, 100, 200], { correction: 'isotropic', denominator: 'n(n-1)' })
ripleyL(points, region, [50, 100, 200]) // 0.1 estimator: L(r) − r, no correction, A/n²
quadratTest(points, region, 5, 5, { statistic: 'pearson' }) // X², df, p, dispersion index
```

Parity with spatstat (Baddeley, Rubak & Turner 2015), cross-checked against
independent scipy computations (numerical quadrature and root finding for
every area and arc):

| here | spatstat | definition |
| --- | --- | --- |
| `ripleyK(…, { correction: 'none', denominator: 'n(n-1)' })` | `Kest(X, correction = "none")` | $\frac{A}{n(n-1)}\sum_{i\ne j}\mathbf 1[d_{ij}\le r]$ |
| `ripleyK(…, { correction: 'isotropic' })` | `Kest(X, correction = "isotropic")` | weights $2\pi d_{ij}/\lvert\partial B(x_i,d_{ij})\cap W\rvert$, clipped to [1, 100] |
| `ripleyK(…, { correction: 'translation' })` | `Kest(X, correction = "translate")` | weights $A/\lvert W\cap(W + x_j - x_i)\rvert$, clipped at 100 |
| `ripleyK(…, { correction: 'border', denominator: 'n2' })` | `Kest(X, correction = "border")` | reduced sample, $\hat\lambda = n/A$ |
| `clarkEvans(…, { correction: 'donnelly' })` | `clarkevans.test(X, correction = "Donnelly")` | $\bar r_{exp} = \tfrac{1}{2\sqrt\lambda} + (0.0514 + 0.0412/\sqrt n)P/n$, rect only |
| `quadratTest` | `quadrat.test(X, nx, ny)` | $X^2$ or $G^2$ on $m-1$ df; `two.sided` p $= 2\min(P_{lo}, P_{up})$ |

**The K denominator.** 0.1's `ripleyL` normalised by $A/n^2$; spatstat uses
$A/(n(n-1))$, which removes the factor $(n-1)/n$ a fixed-n (binomial) CSR
field puts on the pair count. At n = 50 the two differ by 2 % in K. `ripleyL` keeps the 0.1 estimator; `ripleyK` defaults to
spatstat's. Two differences remain: spatstat reports `NA` beyond the radius
where a correction is defined (translation: the shorter side; isotropic: the
bounding radius) — `ripleyK` computes every radius; spatstat approximates a
disk window by a polygon — the weights here are exact for disks. The
Clark–Evans SE uses Clark & Evans's published 0.26136 (spatstat: the exact
$\sqrt{(4-\pi)/(4\pi)} = 0.261362\ldots$).

## Envelope tests: pointwise vs global

```ts
import { csrEnvelope } from '@mindpeeker/field'

const env = await csrEnvelope(points, reader, region, [2, 4, 6, 8, 10, 14], { runs: 999 })
env.global.p // one p over all radii (extreme-rank envelope, ERL tie-breaking)
env.global.mad.p // maximum-absolute-deviation test
env.pointwiseP // per radius — valid only for a radius fixed in advance
```

`csrEnvelope` takes the **observed points**, computes their $\hat L(r) - r$
with the chosen estimator (default: `ripleyL`'s), draws `runs` CSR fields of
the same size and returns the simulated curves, the pointwise band
`lo`/`hi`, the pointwise p per radius, and two global tests: the extreme-rank
envelope of Myllymäki, Mrkvička, Grabarnik, Seijo & Hahn (2017, JRSS-B 79:381)
with its ERL p and a $100(1-\alpha)\%$ global band, and the MAD test (Diggle
1979; Baddeley, Diggle, Hardegen, Lawrence, Milne & Nair 2014) with the
reference curve averaged over all $s+1$ curves.

A pointwise band is a valid test at **one** radius chosen beforehand. Reading
it across radii is a multiple test: over 1000 CSR fields (n = 50, 39 runs, six
radii) the observed curve left the band at a pre-chosen radius in 4.7 % of
fields but at some radius in 14.2 %; the global rank test rejected in 4.5 %
and MAD in 3.1 %. Myllymäki et al. recommend ≥ 2499 runs for a stable global
envelope at α = 0.05.

If a simulated field equals the observed one — the observed field was drawn
from the same recorded batch, or from a source whose `stream()` restarts —
`csrEnvelope`, `fieldSignificance`, `kdeSignificance` and `scanStatistic`
throw `invalid_config` instead of returning a test with no power.

The 0.1 call `csrEnvelope(source, count, region, radii, runs)` still works
and returns the band, curves and accounting; it is deprecated because it
cannot compute a p or detect a replayed field.

## Kernel density attractors (pyrandonaut parity)

```ts
import { kdeAttractor, kdeSignificance, kernelDensity } from '@mindpeeker/field'

const grid = kernelDensity(points, region, { bandwidth: 'silverman', grid: 100 })
const peak = kdeAttractor(points, region, { bandwidth: 'silverman', grid: 100, extent: 'data' })
const tested = await kdeSignificance(reader, points, region, { grid: 50, runs: 199 })
```

The open Randonaut ports (openrandonaut/pyrandonaut, OpenRando) take the
attractor as the argmax of a Gaussian KDE: scipy `gaussian_kde` with
`bw_method="silverman"` on a 100×100 `mgrid` spanning the points' bounding
box. `kdeAttractor` with `{ bandwidth: 'silverman', grid: 100, extent: 'data' }`
returns that node exactly (checked against scipy); `kdeVoid` is the argmin
over nodes inside the region. `'scott'` and `'silverman'` are scipy's
covariance rules — identical in two dimensions ($f = n^{-1/6}$); a number is
an isotropic σ in region units. No edge correction. `kdeSignificance` reruns
the whole procedure on CSR fields and ranks the observed maximum and
minimum density — the chance baseline the ports never report.

## Scan statistic

```ts
import { scanStatistic } from '@mindpeeker/field'

const scan = await scanStatistic(points, region, { runs: 999 })
// scan.cluster: { center, radius, count, expected, llr, relativeRisk }; scan.pValue
```

Kulldorff's (1997) circular scan with area as the population at risk: over
circles centred on each point with radii through its neighbours (window area
≤ `maxFraction`·A, default ½), maximise
$c\ln(c/E) + (n-c)\ln\frac{n-c}{n-E}$ for $c > E = n\lvert B\cap W\rvert/A$.
The p is the Monte-Carlo rank of the maximum among `runs` CSR fields — from
`source` if given, otherwise from a seeded internal PRNG (`seed`, default 0)
so the result is reproducible. Cost $O(\text{runs}\cdot n^2\log n)$.

## Geo (`@mindpeeker/field/geo`)

```ts
import { geohashEncode, geohashNeighbours, haversine, pointToLatLon, sampleCap, sampleLatLonBox } from '@mindpeeker/field/geo'

const here = { lat: 40.7128, lon: -74.006 }
const spot = pointToLatLon(here, points[0]) // disk field in metres → coordinate; +x east, +y north
haversine(here, spot) // ≈ the point's distance from the centre

const far = await sampleCap(reader, here, 500_000) // area-uniform on the sphere, any radius
const boxed = await sampleLatLonBox(reader, { south: 10, north: 20, west: 170, east: -170 })
geohashEncode(far, 7)
geohashNeighbours('dr5regw')
```

- `pointToLatLon` maps a planar disk point along its bearing (azimuthal
  equidistant): area-uniform to a relative error of order $(r/R)^2$, fine at
  city scale.
- `sampleCap` is exact at any radius: $1-\cos\theta = u(1-\cos(r/R))$
  (computed as $\theta = 2\arcsin(\sqrt u\sin(r/2R))$), bearing $2\pi v$.
- `sampleLatLonBox` draws $\varphi = \arcsin(\sin\varphi_1 + u(\sin\varphi_2 - \sin\varphi_1))$,
  $\lambda$ uniform; `west > east` crosses the antimeridian.
- Coordinates are validated (finite, latitude in [-90, 90]); longitudes come
  back in [-180, 180] with an exact 180 kept.
- Geohash (Niemeyer 2008): a value at a bisection midpoint takes the upper
  half; neighbours wrap the antimeridian and are `null` beyond a pole.
  Encodings, cells and neighbours are checked against pygeohash.

Spherical Earth (mean radius 6 371 008.8 m), browser-safe.

## Errors

Every failure is a `FieldError` with a stable `code`:

| code | when |
| --- | --- |
| `invalid_config` | bad count, region, radius, radii, runs, options, coordinates; points outside the region or non-finite; an input that is not a byte source (oracle `invalid_input`); a replayed observed field |
| `insufficient_data` | too few points; a singular KDE covariance; an undefined border-corrected curve |
| `insufficient_entropy` | a finite input ran out (the oracle code, kept verbatim) |
| `aborted` | the `signal` fired |
| `source_error` | the entropy source failed, or a reader was used after `close()`; `cause` holds the original |

Options, regions, radii, points and the input's shape are validated before
the first byte is read.

## Behaviour changes in 0.2.0

- **Hotspot statistics.** The expectation is edge-corrected per point,
  $(n-1)\lvert B\cap W\rvert/A$, and the tails are exact binomial. `pValue`
  (now equal to the new `pSingle`) changes value: 0.1 applied Poisson tails
  with $\mu = n\pi r^2/A$ to every point, which made `void.pValue` $e^{-\mu}$
  (0.018 at the default) on essentially every CSR field. `Hotspot` gains
  `expected`, `power`, `z`, `pSingle`.
- `FieldResult.expectedNeighbours` and the default radius use $n-1$: the
  radius is $\sqrt{\text{expectedNeighbours}\cdot A/((n-1)\pi)}$ (0.1: $n$).
- Passing both `radius` and `expectedNeighbours` throws `invalid_config`
  (0.1 silently ignored `expectedNeighbours`).
- Ties in neighbour count are broken by lexicographic (x, y) instead of an
  FNV hash, so the chosen point can differ for tied counts.
- `attractors`, `clarkEvans`, `ripleyL` reject non-finite points and points
  outside the region (`invalid_config`) instead of returning silently wrong
  statistics.
- **Error codes.** A finite input that runs out rejects with
  `insufficient_entropy` (0.1: `insufficient_data`). Oracle `invalid_input`
  maps to `invalid_config` and source failures to the new `source_error`
  (0.1 let raw `OracleError`s escape).
- Sampling functions close the readers they create (a live provider's stream
  is released after `sampleField`); a `ByteReader` input is accepted and left
  open.
- **`csrEnvelope`** has a new primary signature
  `csrEnvelope(observedPoints, source, region, radii, { runs, … })` returning
  the observed curve, pointwise and global tests; the 0.1 positional form is
  deprecated. Both return `radii`, `mean`, `simulations` and `accounting`,
  validate radii before drawing, and the new form throws `invalid_config` on
  a replayed field. The band is documented as pointwise (0.1 called it a
  significance level).
- `destination` keeps an exact longitude of 180 (0.1 returned -180) and only
  wraps longitudes outside [-180, 180]; `haversine`, `destination` and
  `pointToLatLon` validate their inputs.
- `sampleField` caps `count` at 10⁷; `samplePoint` validates its region.
- The Clark–Evans p-value is computed from `@mindpeeker/negentropy/numerics`
  (same values as `normalP`).

New: `fieldSignificance`, `ripleyK`, `quadratTest`, `kernelDensity`,
`kdeAttractor`, `kdeVoid`, `kdeSignificance`, `scanStatistic`, the
`correction` option of `clarkEvans`, and in `./geo`: `sampleCap`,
`sampleLatLonBox`, `normalizeLon`, `validateLatLon`, `geohashEncode`,
`geohashDecode`, `geohashNeighbours`.

## What this will not tell you

A high-scoring attractor is a **chance-clustering flag**, not evidence of
mind–matter interaction — a uniform random field produces attractors every
time, and its `pSingle` is small most of the time. The number to report is
the whole-field p from `fieldSignificance` (or `kdeSignificance`,
`scanStatistic`, the global envelope p), with the statistic, radius and run
count registered before the field is drawn. A small whole-field p says the
pattern is unlikely under CSR from *this* source; it does not say why. What
the package guarantees is the *statistics*: unbiased sampling, exact
Monte-Carlo nulls, closed-form edge corrections checked against independent
numerics, and p-values that mean what their names say.

## Development

```sh
bun test                                             # fixtures checked in — no Python needed
uv run scripts/fixtures/generate.py                  # 0.1 numpy port (field.json)
uv run scripts/fixtures/generate_stats.py            # scipy: geometry, hotspots, K, quadrats (stats.json)
uv run scripts/fixtures/generate_density.py          # scipy/pygeohash: KDE, scan, envelopes, geohash (density.json)
```

`field.json` is a same-formula numpy port of 0.1's Clark–Evans and $L(r)$;
`stats.json` and `density.json` come from independent numerics
(quadrature, root finding, scipy estimators, pygeohash) and the definitions
in spatstat's sources, not from this package's code.
