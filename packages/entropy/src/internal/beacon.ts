import { EntropyError } from '../errors.js'
import type {
  BeaconProvider,
  BeaconRound,
  BeaconRoundResult,
  EntropySourceAttribution,
  EntropySourceInfo,
} from '../types.js'
import { requireInteger } from './options.js'
import { DEFAULT_TIMEOUT_MS, defineProvider, type ProviderSpec, runWithBudget } from './provider.js'

export interface BeaconSpec extends ProviderSpec {
  /** Fetch one round; `chain` is only passed to `chained` beacons. */
  getRound(round: number, opts: { signal: AbortSignal; chain?: number }): Promise<BeaconRoundResult>
  /** Rounds are numbered per chain (NIST IR 8213): accept the `chain` option. */
  chained?: boolean
  /** Lowest valid round number. Default 1. */
  minRound?: number
}

/** Attribution for a beacon result: the source identity plus the rounds used, in byte order. */
export function attribution(
  info: EntropySourceInfo,
  rounds: readonly BeaconRound[],
): EntropySourceAttribution {
  const { name, kind, privacy } = info
  return rounds.length > 0 ? { name, kind, privacy, rounds } : { name, kind, privacy }
}

/** Build a `BeaconRoundResult` for one fetched round. */
export function roundResult(
  info: EntropySourceInfo,
  round: BeaconRound,
  bytes: Uint8Array,
): BeaconRoundResult {
  return { bytes, round, sources: [attribution(info, [round])] }
}

/** A round with its optional fields only when they carry a value. */
export function beaconRound(
  round: number,
  extra: { chain?: number; timestamp?: number; signature?: unknown } = {},
): BeaconRound {
  const out: {
    round: number
    chain?: number
    timestamp?: number
    signature?: string
  } = { round }
  if (extra.chain !== undefined) out.chain = extra.chain
  if (extra.timestamp !== undefined && Number.isFinite(extra.timestamp)) {
    out.timestamp = extra.timestamp
  }
  if (typeof extra.signature === 'string' && extra.signature.length > 0) {
    out.signature = extra.signature
  }
  return out
}

/**
 * `defineProvider` plus `getRound(round, opts)`: the round number (integer ≥
 * `minRound`) and `chain` (integer ≥ 1, chained beacons only) are validated
 * with `invalid_request`, and the call runs under the same timeout/abort
 * contract as `getBytes`.
 */
export function defineBeacon(spec: BeaconSpec): BeaconProvider {
  const base = defineProvider(spec)
  const { name, minRound = 1 } = spec

  const beacon: BeaconProvider = {
    name: base.name,
    kind: base.kind,
    privacy: base.privacy,
    getBytes: base.getBytes,
    stream: base.stream,

    async getRound(round, opts = {}) {
      requireInteger(round, 'round', minRound, name)
      if (opts.chain !== undefined) {
        if (!spec.chained) {
          throw new EntropyError('invalid_request', `${name} has a single chain: omit chain`, {
            provider: name,
          })
        }
        requireInteger(opts.chain, 'chain', 1, name)
      }
      const result = await runWithBudget(
        name,
        opts,
        spec.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
        (signal) => spec.getRound(round, { signal, chain: opts.chain }),
      )
      if (!(result?.bytes instanceof Uint8Array) || result.bytes.length === 0) {
        throw new EntropyError('bad_response', 'beacon round carried no bytes', { provider: name })
      }
      return result
    },
  }
  return Object.freeze(beacon)
}
