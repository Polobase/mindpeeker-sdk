import {
  type NistFamilyOptions,
  type NistVerifyOptions,
  nistPulseBeacon,
} from '../internal/nist-pulse.js'
import type { BeaconProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'nist-beacon',
  kind: 'beacon',
  privacy: 'public',
})

export interface NistBeaconOptions extends NistFamilyOptions, NistVerifyOptions {}

/**
 * NIST Randomness Beacon 2.0 — 512 signed bits every 60 seconds, in the
 * pulse format of NIST IR 8213 (still an initial public draft; NIST labels
 * the 2.0 service a beta). PUBLIC randomness; NIST's own warning applies:
 * never use beacon values as secret keys. Useful for audits, lotteries and as
 * an `xorMix` auditability input.
 *
 * `verify: true` checks outputValue, certificateId, signature and chain
 * linkage. Live finding (2026-09-17): since pulse 2/1925734
 * (2026-09-03T21:08Z) NIST pulses name a 2048-bit certificate but carry
 * 512-byte (4096-bit) signatures, so signature verification of current NIST
 * pulses fails with `verification`; `verify: 'hash'` still checks outputValue
 * and linkage.
 */
export function nistBeacon(opts: NistBeaconOptions = {}): BeaconProvider {
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
