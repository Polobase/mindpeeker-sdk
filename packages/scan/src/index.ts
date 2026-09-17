// Re-exported from `@mindpeeker/rate` so a rate never needs a second import.
export type { Rate } from '@mindpeeker/rate'
export type { BroadcastTarget } from './broadcast/broadcast.js'
export { broadcast } from './broadcast/broadcast.js'
export { parseReceipt, serializeReceipt, WITNESS_KINDS } from './broadcast/receipt.js'
export { rateFromCharCodes, sha256Hex, signatureToRate } from './broadcast/signature.js'
export type {
  CatalogFromEntriesOptions,
  RateEntryLike,
  RateEntrySystems,
} from './catalog.js'
export { catalogFromRateEntries, defineCatalog, rateFromSystems } from './catalog.js'
export type { ScanErrorCode, ScanErrorOptions } from './errors.js'
export { ScanError } from './errors.js'
export type {
  TripolarControlReport,
  TripolarScanOptions,
  TripolarScanReport,
} from './protocol/tripolar-scan.js'
export { scanTripolar } from './protocol/tripolar-scan.js'
export {
  binomialTwoSidedP,
  byBayesFactor,
  deviationStat,
  P0,
  scanDeviation,
  tieBreakKey,
} from './scan/deviation.js'
export type { RacedItem, RaceOptions, RaceResult, ResolvedRaceOptions } from './scan/race.js'
export { race, raceSubsetSize, resolveRaceOptions } from './scan/race.js'
export { scan } from './scan/scan.js'
export type { SweepDials, SweepModel, SweepOptions, SweepReport } from './scan/sweep.js'
export { sweepNullPmf, sweepScan } from './scan/sweep.js'
export {
  GV_AUTO_MODE_THRESHOLD,
  generalVitality,
  generalVitalityReader,
  generalVitalitySf,
} from './scan/vitality.js'
export type {
  AdjustedDeviationResult,
  BroadcastMode,
  BroadcastOptions,
  BroadcastReceipt,
  BroadcastTick,
  ByteSource,
  ByteStreamOptions,
  Catalog,
  CatalogItem,
  DeviationOptions,
  DeviationReport,
  DeviationResult,
  EntropyAccounting,
  MultiplicitySummary,
  OmnibusTest,
  ScanMode,
  ScanOptions,
  ScanReport,
  ScanResult,
  SignatureOptions,
  VitalityOptions,
  Witness,
  WitnessKind,
} from './types.js'
