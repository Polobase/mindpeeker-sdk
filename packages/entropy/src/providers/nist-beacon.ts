import { type NistFamilyOptions, nistPulseBeacon } from '../internal/nist-pulse.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'nist-beacon',
  kind: 'beacon',
  privacy: 'public',
})

export interface NistBeaconOptions extends NistFamilyOptions {}

/**
 * NIST Randomness Beacon 2.0 — 512 signed bits every 60 seconds. PUBLIC
 * randomness; NIST's own warning applies: never use beacon values as secret
 * keys. Useful for audits, lotteries and as an `xorMix` auditability input.
 */
export function nistBeacon(opts: NistBeaconOptions = {}): EntropyProvider {
  return nistPulseBeacon(
    {
      info: INFO,
      defaultBaseUrl: 'https://beacon.nist.gov/beacon/2.0',
      latestPath: '/pulse/last',
      defaultPollIntervalMs: 60_000,
    },
    opts,
  )
}
