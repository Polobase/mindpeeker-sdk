import { EntropyError } from '../errors.js'
import { type NistFamilyOptions, nistPulseBeacon } from '../internal/nist-pulse.js'
import type { BeaconProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'uchile',
  kind: 'beacon',
  privacy: 'public',
})

export interface UchileOptions extends NistFamilyOptions {}

/**
 * Random UChile (CLCERT, Universidad de Chile) — hybrid beacon mixing a local
 * quantum device with seismic, radio and other public inputs; 512 bits every
 * 60 seconds. PUBLIC randomness.
 *
 * Unverified: UChile publishes cipherSuite 1 pulses, which this library cannot
 * verify, so there is no `verify` option (passing one throws
 * `invalid_request`).
 */
export function uchile(opts: UchileOptions = {}): BeaconProvider {
  if ((opts as { verify?: unknown })?.verify) {
    throw new EntropyError(
      'invalid_request',
      'uchile pulses use cipherSuite 1, which cannot be verified here',
      { provider: INFO.name },
    )
  }
  return nistPulseBeacon(
    {
      info: INFO,
      defaultBaseUrl: 'https://random.uchile.cl/beacon/2.1-beta',
      // NB: their '/pulse/last' route is a genuine 404 — the query form is
      // the working "latest" endpoint.
      latestPath: '/pulse?chainId=last&pulseId=last',
      defaultPollIntervalMs: 60_000,
    },
    { ...opts, verify: false },
  )
}
