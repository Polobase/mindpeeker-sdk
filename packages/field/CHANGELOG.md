# @mindpeeker/field

## 0.2.0

### Minor Changes

- First release on npm. `@mindpeeker/field` draws unbiased point fields from an entropy source and tests them against complete spatial randomness (CSR): attractors and voids with calibrated whole-field p-values, edge-corrected Ripley's K with global envelope tests, quadrat counts, kernel-density attractors, Kulldorff's scan statistic, and spherical samplers with geohash in `@mindpeeker/field/geo`. A field drawn from a good RNG is CSR, so an "attractor" is expected chance clustering; the geometry is asserted, the intention hypothesis is not.

  Changes relative to the unpublished 0.1.0 workspace version (relevant only if you used it from the repository):

  - BREAKING: `Hotspot.pValue` changes value. It now equals the new `pSingle`, the exact Binomial(n − 1, |B ∩ W|/A) tail with an edge-corrected expectation. 0.1.0 applied a Poisson tail with μ = nπr²/A, which made `void.pValue` e^−μ (0.018 at the default radius) on essentially every CSR field. For a claim about the whole field use `fieldSignificance`: in simulated CSR fields its attractor p was ≤ 0.05 in 4.0% (n = 60) and 4.7% (n = 300) of fields, while the single-point tail was ≤ 0.05 in 58% and 100%.
  - BREAKING: `FieldResult.expectedNeighbours` and the default radius use n − 1; passing both `radius` and `expectedNeighbours` throws `invalid_config`; ties in neighbour count break by (x, y) instead of a hash.
  - BREAKING: `attractors`, `clarkEvans` and `ripleyL` reject non-finite points and points outside the region (`invalid_config`).
  - BREAKING: `FieldErrorCode` gains `insufficient_entropy` (a finite input that runs out; was `insufficient_data`) and `source_error`. Oracle `invalid_input` maps to `invalid_config`, and raw `OracleError`s no longer escape.
  - BREAKING: `csrEnvelope(observedPoints, source, region, radii, opts)` is the new primary signature. It computes the observed curve itself and returns pointwise p-values and two global tests (extreme-rank envelope and MAD). The 0.1.0 positional form still works but is deprecated. The band is documented as pointwise: in 1000 CSR fields the observed curve left it at a pre-chosen radius in 4.7% of fields but at some radius in 14.2%.
  - BREAKING: `csrEnvelope`, `fieldSignificance`, `kdeSignificance` and `scanStatistic` throw `invalid_config` when a simulated field equals the observed one (a replayed batch or a restarting source), instead of returning a test with no power.
  - BREAKING: `destination` keeps an exact longitude of 180 (0.1.0 returned −180); `haversine`, `destination` and `pointToLatLon` validate their inputs; `sampleField` caps `count` at 10⁷.
  - Sampling functions close the readers they create; a `ByteReader` input is accepted and left open.
  - New: `fieldSignificance`, `Hotspot.expected`/`power`/`z`/`pSingle`, `ripleyK` (border, isotropic and translation corrections), the Donnelly correction for `clarkEvans`, `quadratTest`, `kernelDensity`, `kdeAttractor`, `kdeVoid`, `kdeSignificance`, `scanStatistic`, and in `./geo`: `sampleCap`, `sampleLatLonBox`, `normalizeLon`, `validateLatLon`, `geohashEncode`, `geohashDecode`, `geohashNeighbours`.

### Patch Changes

- Updated dependencies
- Updated dependencies
  - @mindpeeker/negentropy@0.2.0
  - @mindpeeker/oracle@0.2.0
