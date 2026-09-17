import {
  type NistFamilyOptions,
  type NistVerifyOptions,
  nistPulseBeacon,
} from '../internal/nist-pulse.js'
import { requireOneOf } from '../internal/options.js'
import type { BeaconProvider } from '../types.js'

export type InmetroVariant = 'primary' | 'combination'

export interface InmetroOptions extends NistFamilyOptions, NistVerifyOptions {
  /**
   * 'primary' (default): Inmetro's own quantum-optical beacon, 60 s pulses.
   * 'combination': CONCAT+VDF combination of UChile, RANDOM.ORG and NIST
   * seeds, one pulse every 10 minutes.
   */
  variant?: InmetroVariant
}

/**
 * Inmetro Brazilian randomness beacon (national metrology institute) —
 * NIST IR 8213 format, cipherSuite 0. PUBLIC randomness.
 *
 * `verify: 'hash'` checks outputValue (Inmetro length-prefixes the signature,
 * as the IR 8213 draft specifies) and chain linkage. `verify: true` also
 * needs the certificate, which Inmetro's `/certificate/{id}` route refused
 * with HTTP 400 "Invalid certificate identifier" in a live check
 * (2026-09-17), so it currently fails with `network`.
 */
export function inmetro(opts: InmetroOptions = {}): BeaconProvider {
  const { variant = 'primary', ...rest } = opts
  requireOneOf(variant, ['primary', 'combination'], 'variant', 'inmetro')
  if (variant === 'combination') {
    return nistPulseBeacon(
      {
        info: Object.freeze({ name: 'inmetro(combination)', kind: 'beacon', privacy: 'public' }),
        defaultBaseUrl: 'https://beacon.inmetro.gov.br/combination/beacon/2.0',
        // quirk: latest has NO /pulse segment, but by-index DOES
        latestPath: '/last',
        pulsePath: (_chain, i) => `/pulse/${i}`,
        chainLastPath: null,
        defaultPollIntervalMs: 600_000,
      },
      rest,
    )
  }
  return nistPulseBeacon(
    {
      info: Object.freeze({ name: 'inmetro', kind: 'beacon', privacy: 'public' }),
      defaultBaseUrl: 'https://beacon.inmetro.gov.br/beacon/2.1',
      latestPath: '/pulse/last',
      defaultPollIntervalMs: 60_000,
    },
    rest,
  )
}
