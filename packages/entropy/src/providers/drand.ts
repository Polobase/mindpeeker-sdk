import { EntropyError } from '../errors.js'
import { raceSignal } from '../internal/abort.js'
import { attribution, beaconRound, defineBeacon, roundResult } from '../internal/beacon.js'
import { bytesToHex, concatBytes, hexToBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
import { type BaseUrlOptions, resolveBaseUrls, withMirrors } from '../internal/mirrors.js'
import { requireOneOf, requireTimeoutMs } from '../internal/options.js'
import { beaconStream } from '../internal/stream.js'
import type { BeaconProvider, BeaconRound, EntropySourceInfo } from '../types.js'
import {
  DRAND_CHAINS,
  DRAND_SIGNATURE_BYTES,
  type DrandChainInfo,
  drandRoundAt,
  drandRoundTime,
} from './drand-chain.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'drand',
  kind: 'beacon',
  privacy: 'public',
})
const ROUND_BYTES = 32
const DEFAULT_BASE_URLS = Object.freeze([
  'https://api.drand.sh',
  'https://api2.drand.sh',
  'https://api3.drand.sh',
])
/** Budget of the shared, cached chain-info check. */
const INFO_TIMEOUT_MS = 10_000

/** drand checks: `'none'` (default) or `'structural'` (see `DrandOptions.verify`). */
export type DrandVerifyMode = 'none' | 'structural'

export interface DrandOptions extends BaseUrlOptions {
  fetch?: typeof fetch
  /** Beacon id (letters, digits, `-`, `_`). Default 'quicknet' (3 s rounds, unchained). */
  beacon?: string
  /**
   * Chain parameters for a beacon id that has no entry in `DRAND_CHAINS`:
   * enables round timestamps and `verify: 'structural'` for it.
   */
  chainInfo?: DrandChainInfo
  /** Stream poll cadence: finite, 0 < ms ≤ 2³¹ − 1. Default: the chain period (3000 for quicknet). */
  pollIntervalMs?: number
  /**
   * `'structural'` checks, per mirror and round: the mirror's
   * `/v2/beacons/{id}/info` matches the pinned chain (hash, genesis, period,
   * scheme); the signature has the scheme's length; the round is not from the
   * future (≤ `drandRoundAt(now) + 1`, local clock); and a served
   * `randomness` equals SHA-256(signature). The BLS signature itself is NOT
   * verified (that needs a pairing library). Failures throw `verification`.
   * Default `'none'`.
   */
  verify?: DrandVerifyMode
}

interface DrandRound {
  round?: unknown
  signature?: unknown
  randomness?: unknown
}

interface DrandInfoResponse {
  chain_hash?: unknown
  genesis_time?: unknown
  period?: unknown
  scheme?: unknown
}

interface Round {
  round: number
  bytes: Uint8Array
  meta: BeaconRound
}

function invalid(message: string): EntropyError {
  return new EntropyError('invalid_request', message, { provider: INFO.name })
}

function failed(message: string): EntropyError {
  return new EntropyError('verification', message, { provider: INFO.name })
}

function validateChainInfo(info: DrandChainInfo): DrandChainInfo {
  const ok =
    info !== null &&
    typeof info === 'object' &&
    typeof info.beaconId === 'string' &&
    typeof info.hash === 'string' &&
    /^[0-9a-f]+$/i.test(info.hash) &&
    Number.isFinite(info.genesisTime) &&
    Number.isFinite(info.period) &&
    info.period > 0 &&
    typeof info.scheme === 'string'
  if (!ok)
    throw invalid('chainInfo needs beaconId, hex hash, finite genesisTime, period > 0, scheme')
  return info
}

/**
 * drand / League of Entropy distributed randomness beacon (threshold BLS).
 * PUBLIC randomness: everyone sees every round — never seed secrets from it
 * alone; combine via `xorMix` with a private source for auditable secrets.
 * Randomness is derived as SHA-256(signature), as specified for drand rounds.
 * Results carry `{ round, timestamp, signature }` per round used (timestamps
 * for chains with known parameters), and `getRound(n)` fetches round n.
 */
export function drand(opts: DrandOptions = {}): BeaconProvider {
  const { beacon = 'quicknet', fetch: fetchImpl } = opts
  if (typeof beacon !== 'string' || !/^[A-Za-z0-9_-]+$/.test(beacon)) {
    throw invalid(`beacon must be an id of letters, digits, '-' or '_', got ${String(beacon)}`)
  }
  const bases = resolveBaseUrls(opts, DEFAULT_BASE_URLS, INFO.name)
  const verify = requireOneOf(opts.verify ?? 'none', ['none', 'structural'], 'verify', INFO.name)
  const chain: DrandChainInfo | undefined =
    opts.chainInfo !== undefined
      ? validateChainInfo(opts.chainInfo)
      : (DRAND_CHAINS as Readonly<Record<string, DrandChainInfo>>)[beacon]
  if (verify === 'structural' && !chain) {
    throw invalid(`verify: 'structural' needs chainInfo for the unpinned beacon '${beacon}'`)
  }
  const pollIntervalMs = requireTimeoutMs(
    opts.pollIntervalMs ?? (chain ? chain.period * 1000 : 3000),
    'pollIntervalMs',
    INFO.name,
  )
  const infoChecks = new Map<string, Promise<void>>()

  function checkInfo(base: string, pinned: DrandChainInfo, signal: AbortSignal): Promise<void> {
    let check = infoChecks.get(base)
    if (!check) {
      check = fetchJson<DrandInfoResponse>(`${base}/v2/beacons/${beacon}/info`, {
        provider: INFO.name,
        signal: AbortSignal.timeout(INFO_TIMEOUT_MS),
        fetchImpl,
      }).then((info) => {
        const matches =
          typeof info?.chain_hash === 'string' &&
          info.chain_hash.toLowerCase() === pinned.hash.toLowerCase() &&
          info.genesis_time === pinned.genesisTime &&
          info.period === pinned.period &&
          info.scheme === pinned.scheme
        if (!matches) {
          throw failed(`${base} serves chain info that does not match the pinned '${beacon}' chain`)
        }
      })
      check.catch(() => infoChecks.delete(base))
      infoChecks.set(base, check)
    }
    return raceSignal(check, signal)
  }

  async function randomnessOf(signature: string): Promise<{ sig: Uint8Array; bytes: Uint8Array }> {
    let sig: Uint8Array<ArrayBuffer>
    try {
      sig = hexToBytes(signature)
    } catch (error) {
      throw new EntropyError('bad_response', 'invalid signature hex', {
        provider: INFO.name,
        cause: error,
      })
    }
    return { sig, bytes: new Uint8Array(await crypto.subtle.digest('SHA-256', sig)) }
  }

  async function checkRound(round: number, sig: Uint8Array, bytes: Uint8Array, res: DrandRound) {
    const pinned = chain as DrandChainInfo
    const expectedBytes = DRAND_SIGNATURE_BYTES[pinned.scheme]
    if (expectedBytes !== undefined && sig.length !== expectedBytes) {
      throw failed(
        `round ${round}: ${sig.length}-byte signature, ${pinned.scheme} uses ${expectedBytes}`,
      )
    }
    const newest = drandRoundAt(Date.now(), pinned) + 1
    if (round > newest) throw failed(`round ${round} is from the future (now: ${newest - 1})`)
    if (res.randomness !== undefined) {
      if (
        typeof res.randomness !== 'string' ||
        res.randomness.toLowerCase() !== bytesToHex(bytes)
      ) {
        throw failed(`round ${round}: randomness is not SHA-256(signature)`)
      }
    }
  }

  function fetchRound(which: 'latest' | number, signal: AbortSignal): Promise<Round> {
    return withMirrors(bases, async (base) => {
      if (verify === 'structural') await checkInfo(base, chain as DrandChainInfo, signal)
      const res = await fetchJson<DrandRound>(`${base}/v2/beacons/${beacon}/rounds/${which}`, {
        provider: INFO.name,
        signal,
        fetchImpl,
      })
      const { round, signature } = res ?? {}
      if (
        !Number.isSafeInteger(round) ||
        (round as number) < 1 ||
        typeof signature !== 'string' ||
        signature.length === 0
      ) {
        throw new EntropyError('bad_response', 'malformed drand round', { provider: INFO.name })
      }
      if (which !== 'latest' && round !== which) {
        throw new EntropyError('bad_response', `requested round ${which}, got ${round}`, {
          provider: INFO.name,
        })
      }
      const { sig, bytes } = await randomnessOf(signature)
      if (verify === 'structural') await checkRound(round as number, sig, bytes, res)
      const meta = beaconRound(round as number, {
        timestamp: chain ? drandRoundTime(round as number, chain) : undefined,
        signature,
      })
      return { round: round as number, bytes, meta }
    })
  }

  return defineBeacon({
    ...INFO,
    defaultChunkBytes: ROUND_BYTES,

    async getBytes(length, reqOpts) {
      const signal = reqOpts?.signal as AbortSignal
      const roundsNeeded = Math.ceil(length / ROUND_BYTES)
      const latest = await fetchRound('latest', signal)
      const rounds = [latest]
      // Past rounds are just as public as the latest one — walk backwards.
      for (let i = 1; i < roundsNeeded; i++) {
        const round = latest.round - i
        if (round < 1) {
          throw new EntropyError('insufficient_entropy', 'drand chain too short for request', {
            provider: INFO.name,
          })
        }
        rounds.push(await fetchRound(round, signal))
      }
      return {
        bytes: concatBytes(rounds.map((r) => r.bytes)).slice(0, length),
        sources: [
          attribution(
            INFO,
            rounds.map((r) => r.meta),
          ),
        ],
      }
    },

    async getRound(round, { signal }) {
      const fetched = await fetchRound(round, signal)
      return roundResult(INFO, fetched.meta, fetched.bytes)
    },

    stream(streamOpts = {}) {
      return beaconStream(
        async (signal) => {
          const { round, bytes } = await fetchRound('latest', signal)
          return { id: round, bytes }
        },
        pollIntervalMs,
        INFO.name,
        streamOpts,
      )
    },
  })
}
