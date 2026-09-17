/**
 * @mindpeeker/field — spatial negentropy.
 *
 * Turn an entropy stream into a 2-D point field and ask whether it holds any
 * order: attractors and voids with calibrated whole-field p-values, Ripley's
 * K/L with edge corrections and global envelope tests, Clark–Evans, quadrat
 * counts, kernel density attractors and Kulldorff's scan statistic — always
 * tested against a **complete spatial randomness (CSR)** null, because a
 * field drawn from a good RNG *is* CSR. The geometry is asserted; the
 * intention hypothesis is not. Geographic helpers live behind the
 * `@mindpeeker/field/geo` subpath.
 */

export type { FieldErrorCode, FieldErrorOptions } from './errors.js'
export { FieldError } from './errors.js'
export type { AttractorOptions, FieldResult, Hotspot } from './field/attractors.js'
export { attractors } from './field/attractors.js'
export type { ClarkEvans, ClarkEvansOptions } from './field/csr.js'
export { clarkEvans, ripleyL } from './field/csr.js'
export type { CsrEnvelope, CsrEnvelopeOptions, CsrEnvelopeTest } from './field/envelope.js'
export { csrEnvelope } from './field/envelope.js'
export type { MadTest, RankEnvelopeTest } from './field/global-envelope.js'
export type {
  Bandwidth,
  KdeExtreme,
  KdeExtremeSignificance,
  KdeSignificance,
  KdeSignificanceOptions,
  KernelDensity,
  KernelDensityOptions,
} from './field/kde.js'
export { kdeAttractor, kdeSignificance, kdeVoid, kernelDensity } from './field/kde.js'
export type { QuadratTest, QuadratTestOptions } from './field/quadrat.js'
export { quadratTest } from './field/quadrat.js'
export type { KCorrection, KDenominator, RipleyK, RipleyKOptions } from './field/ripley.js'
export { MAX_EDGE_WEIGHT, ripleyK } from './field/ripley.js'
export type { SampleFieldOptions } from './field/sample.js'
export { sampleField, samplePoint } from './field/sample.js'
export type { ScanCluster, ScanStatistic, ScanStatisticOptions } from './field/scan.js'
export { scanStatistic } from './field/scan.js'
export type {
  ExtremeSignificance,
  FieldSignificance,
  FieldSignificanceOptions,
} from './field/significance.js'
export { fieldSignificance } from './field/significance.js'
export type { FieldInput } from './internal/draw.js'
export type { EntropyAccounting, FieldRegion, Point } from './types.js'
export { regionArea } from './types.js'
