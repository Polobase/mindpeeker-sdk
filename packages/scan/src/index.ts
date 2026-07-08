// Re-exported from `@mindpeeker/rate` so a rate never needs a second import.
export type { Rate } from '@mindpeeker/rate'
export type { BroadcastTarget } from './broadcast/broadcast.js'
export { broadcast, parseReceipt, serializeReceipt } from './broadcast/broadcast.js'
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
  TripolarScanOptions,
  TripolarScanReport,
} from './protocol/tripolar-scan.js'
export { scanTripolar } from './protocol/tripolar-scan.js'
export { P0, scanDeviation } from './scan/deviation.js'
export { scan } from './scan/scan.js'
export { generalVitality } from './scan/vitality.js'
export type {
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
  ScanMode,
  ScanOptions,
  ScanReport,
  ScanResult,
  VitalityOptions,
  Witness,
} from './types.js'
