import { EntropyError } from '../errors.js'

/** Public parameters of a drand chain, as served by `/v2/beacons/{id}/info`. */
export interface DrandChainInfo {
  /** Beacon id on the League of Entropy network ('quicknet', 'default', 'evmnet'). */
  readonly beaconId: string
  /** Chain hash (hex) — commits to the public key, genesis, period and scheme. */
  readonly hash: string
  /** Genesis time, seconds since the Unix epoch (round 1 is published then). */
  readonly genesisTime: number
  /** Seconds between rounds. */
  readonly period: number
  /** Signature scheme id. */
  readonly scheme: string
}

/**
 * The League of Entropy mainnet chains, pinned from
 * `https://api.drand.sh/v2/beacons/{id}/info` (checked 2026-09-17).
 */
export const DRAND_CHAINS: Readonly<Record<'quicknet' | 'default' | 'evmnet', DrandChainInfo>> =
  Object.freeze({
    quicknet: Object.freeze({
      beaconId: 'quicknet',
      hash: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
      genesisTime: 1692803367,
      period: 3,
      scheme: 'bls-unchained-g1-rfc9380',
    }),
    default: Object.freeze({
      beaconId: 'default',
      hash: '8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce',
      genesisTime: 1595431050,
      period: 30,
      scheme: 'pedersen-bls-chained',
    }),
    evmnet: Object.freeze({
      beaconId: 'evmnet',
      hash: '04f1e9062b8a81f848fded9c12306733282b2727ecced50032187751166ec8c3',
      genesisTime: 1727521075,
      period: 3,
      scheme: 'bls-bn254-unchained-on-g1',
    }),
  })

/** Signature size in bytes per drand scheme (G1 = 48 B, G2 = 96 B on BLS12-381; BN254 G1 = 64 B). */
export const DRAND_SIGNATURE_BYTES: Readonly<Record<string, number>> = Object.freeze({
  'bls-unchained-g1-rfc9380': 48,
  'bls-unchained-on-g1': 48,
  'pedersen-bls-chained': 96,
  'pedersen-bls-unchained': 96,
  'bls-bn254-unchained-on-g1': 64,
})

type RoundClock = Pick<DrandChainInfo, 'genesisTime' | 'period'>

function requireClock(info: RoundClock): void {
  const { genesisTime, period } = info ?? ({} as RoundClock)
  if (!Number.isFinite(genesisTime) || !Number.isFinite(period) || !(period > 0)) {
    throw new EntropyError(
      'invalid_request',
      'drand chain info needs a finite genesisTime and a period > 0',
      { provider: 'drand' },
    )
  }
}

/**
 * The drand round being published at `timeMs` (ms since the Unix epoch):
 * $\lfloor (t/1000 − \text{genesis}) / \text{period} \rfloor + 1$, as in the
 * drand client's `roundAt`. Throws `invalid_request` for a non-finite time or
 * a time before genesis.
 */
export function drandRoundAt(timeMs: number, info: RoundClock): number {
  requireClock(info)
  if (!Number.isFinite(timeMs) || timeMs < info.genesisTime * 1000) {
    throw new EntropyError(
      'invalid_request',
      `drandRoundAt needs a finite time at or after genesis, got ${timeMs}`,
      { provider: 'drand' },
    )
  }
  return Math.floor((timeMs - info.genesisTime * 1000) / (info.period * 1000)) + 1
}

/**
 * Publication time of `round` in ms since the Unix epoch:
 * $(\text{genesis} + (\text{round} − 1)\cdot\text{period})\cdot 1000$. Throws
 * `invalid_request` unless `round` is an integer ≥ 1.
 */
export function drandRoundTime(round: number, info: RoundClock): number {
  requireClock(info)
  if (!Number.isSafeInteger(round) || round < 1) {
    throw new EntropyError('invalid_request', `round must be an integer >= 1, got ${round}`, {
      provider: 'drand',
    })
  }
  return (info.genesisTime + (round - 1) * info.period) * 1000
}
