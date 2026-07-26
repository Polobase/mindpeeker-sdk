# @mindpeeker/field

Spatial negentropy — turn an entropy stream into a 2-D point field and ask
whether it holds any **order**.

Where [`@mindpeeker/negentropy`](../negentropy) looks for structure in a time
series, `field` looks for it in *space*: it draws unbiased points from an
entropy source and tests them for clustering against a **complete spatial
randomness (CSR)** null — the rigorous core of a Randonautica-style
attractor / void engine. A field drawn from a good RNG *is* CSR, so any
"attractor" is the expected chance clustering of a random field; every result
comes with a p-value that says how ordinary it is. The geometry is asserted;
the intention hypothesis is not.

Zero-runtime-dependency beyond the SDK, browser-safe. Depends on
`@mindpeeker/oracle` (exact point sampling) and `@mindpeeker/negentropy`
(p-values). Geographic helpers live behind the `@mindpeeker/field/geo` subpath.

## Sampling

```ts
import { sampleField } from '@mindpeeker/field'
import { anu } from '@mindpeeker/entropy' // any provider works structurally

const { points, accounting } = await sampleField(anu(), 1000, { kind: 'disk', radius: 3000 })
// points: area-uniform in the region; accounting: honest bytes/bits receipt
```

Regions are `{ kind: 'rect', width, height }` or `{ kind: 'disk', radius }`.
Points are drawn with the oracle's exact bit reader — no modulo or rounding
bias — and are deterministic in the input bytes.

## Testing for order

```ts
import { clarkEvans, ripleyL, csrEnvelope, attractors } from '@mindpeeker/field'

// nearest-neighbour aggregation index: R < 1 clustered, ≈ 1 CSR, > 1 dispersed
const { R, z, pValue } = clarkEvans(points, region)

// Besag's L(r) − r at each scale (≈ 0 under CSR, positive = clustering)
const l = ripleyL(points, region, [50, 100, 200, 400])

// the honest test: a Monte-Carlo CSR band from the same source
const env = await csrEnvelope(source, points.length, region, [50, 100, 200, 400], 99)
// l[k] outside [env.lo[k], env.hi[k]] is significant at ≈ 2/(runs+1)

// attractor (densest) / void (sparsest) with Poisson-tail p-values under CSR
const { attractor, void: voidSpot } = attractors(points, region)
```

Clark–Evans and Ripley's L are validated against numpy fixtures; the honest
significance decision is the Monte-Carlo `csrEnvelope`, which carries the same
edge bias as the observed statistic, so the comparison is fair.

## Geo (`@mindpeeker/field/geo`)

```ts
import { pointToLatLon, haversine, destination } from '@mindpeeker/field/geo'

// a disk field in metres → real coordinates around a center (the Randonaut move)
const here = { lat: 40.7128, lon: -74.006 }
const spot = pointToLatLon(here, points[0]) // +x east, +y north
haversine(here, spot) // ≈ the point's distance from center
```

Pure spherical-Earth great-circle math, browser-safe.

## What this will not tell you

A high-scoring attractor is a **chance-clustering flag**, not evidence of
mind–matter interaction — a uniform random field produces attractors every
time. Because every point is tested, correct for multiple comparisons
(Bonferroni, or read the `csrEnvelope`) and register any intention before
looking. What the package guarantees is the *statistics*: unbiased sampling,
exact CSR nulls (fixture-validated), and honest p-values either way.

## Development

```sh
bun test                                  # fixtures checked in — no Python needed
uv run scripts/fixtures/generate.py       # regenerate numpy cross-check fixtures
```
