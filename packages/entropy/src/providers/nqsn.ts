import {
  type NistFamilyOptions,
  type NistVerifyOptions,
  nistPulseBeacon,
} from '../internal/nist-pulse.js'
import type { BeaconProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({ name: 'nqsn', kind: 'beacon', privacy: 'public' })

export interface NqsnOptions extends NistFamilyOptions, NistVerifyOptions {}

/**
 * NQSN Singapore quantum randomness beacon (National Quantum-Safe Network) —
 * NIST IR 8213 format, cipherSuite 0, 512 bits every 60 seconds. PUBLIC
 * randomness. The latest-pulse route answers with a 303 redirect that fetch
 * follows. `verify: true` checks outputValue, certificateId (NQSN hashes the
 * PEM text), the RSA signature and chain linkage.
 */
export function nqsn(opts: NqsnOptions = {}): BeaconProvider {
  return nistPulseBeacon(
    {
      info: INFO,
      defaultBaseUrl: 'https://quantum-entropy.sg/beacon/2.0',
      latestPath: '/pulse',
      defaultPollIntervalMs: 60_000,
    },
    opts,
  )
}
