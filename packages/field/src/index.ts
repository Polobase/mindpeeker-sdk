/**
 * @mindpeeker/field — spatial negentropy.
 *
 * Turn an entropy stream into a 2-D point field and ask whether it holds any
 * order: attractors and voids (the rigorous core of a Randonautica-style
 * engine), Ripley's K/L clustering, and Clark–Evans nearest-neighbour
 * statistics — always tested against a **complete spatial randomness (CSR)**
 * null, because a field drawn from a good RNG *is* CSR. The geometry is
 * asserted; the intention hypothesis is not. Geographic helpers live behind
 * the `@mindpeeker/field/geo` subpath.
 */

export type { FieldErrorCode, FieldErrorOptions } from './errors.js'
export { FieldError } from './errors.js'
export type { AttractorOptions, FieldResult, Hotspot } from './field/attractors.js'
export { attractors } from './field/attractors.js'
export type { ClarkEvans, CsrEnvelope } from './field/csr.js'
export { clarkEvans, csrEnvelope, ripleyL } from './field/csr.js'
export type { SampleFieldOptions } from './field/sample.js'
export { sampleField, samplePoint } from './field/sample.js'
export type { EntropyAccounting, FieldRegion, Point } from './types.js'
export { regionArea } from './types.js'
