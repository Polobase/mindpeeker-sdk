import { EntropyError } from '../errors.js'
import { concatBytes, hexToBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
import { defineProvider } from '../internal/provider.js'
import { beaconStream } from '../internal/stream.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'drand',
  kind: 'beacon',
  privacy: 'public',
})
const ROUND_BYTES = 32
const DEFAULT_BASE_URLS = ['https://api.drand.sh', 'https://api2.drand.sh', 'https://api3.drand.sh']
// quicknet emits a round every 3 seconds.
const DEFAULT_POLL_INTERVAL_MS = 3000

export interface DrandOptions {
  fetch?: typeof fetch
  /** Mirrors tried in order per request. */
  baseUrls?: string[]
  /** Beacon id. Default 'quicknet' (3 s rounds, unchained). */
  beacon?: string
  /** Stream poll cadence. Default 3000 (the quicknet round period). */
  pollIntervalMs?: number
}

interface DrandRound {
  round?: unknown
  signature?: unknown
}

/**
 * drand / League of Entropy distributed randomness beacon (threshold BLS).
 * PUBLIC randomness: everyone sees every round — never seed secrets from it
 * alone; combine via `xorMix` with a private source for auditable secrets.
 * Randomness is derived as SHA-256(signature), as specified for unchained
 * beacons like quicknet.
 */
export function drand(opts: DrandOptions = {}): EntropyProvider {
  const {
    baseUrls = DEFAULT_BASE_URLS,
    beacon = 'quicknet',
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    fetch: fetchImpl,
  } = opts

  async function fetchRound(
    which: 'latest' | number,
    signal?: AbortSignal,
  ): Promise<{ round: number; signature: string }> {
    let lastError: unknown
    for (const base of baseUrls) {
      try {
        const res = await fetchJson<DrandRound>(`${base}/v2/beacons/${beacon}/rounds/${which}`, {
          provider: INFO.name,
          signal,
          fetchImpl,
        })
        const { round, signature } = res ?? {}
        if (!Number.isInteger(round) || typeof signature !== 'string' || signature.length === 0) {
          throw new EntropyError('bad_response', 'malformed drand round', { provider: INFO.name })
        }
        return { round: round as number, signature }
      } catch (error) {
        if (!(error instanceof EntropyError) || error.code === 'aborted') throw error
        lastError = error // try the next mirror
      }
    }
    throw lastError
  }

  async function randomnessOf(signature: string): Promise<Uint8Array> {
    let sigBytes: Uint8Array<ArrayBuffer>
    try {
      sigBytes = hexToBytes(signature)
    } catch (error) {
      throw new EntropyError('bad_response', 'invalid signature hex', {
        provider: INFO.name,
        cause: error,
      })
    }
    return new Uint8Array(await crypto.subtle.digest('SHA-256', sigBytes))
  }

  return defineProvider({
    ...INFO,
    defaultChunkBytes: ROUND_BYTES,

    async getBytes(length, reqOpts) {
      const roundsNeeded = Math.ceil(length / ROUND_BYTES)
      const latest = await fetchRound('latest', reqOpts?.signal)
      const chunks = [await randomnessOf(latest.signature)]
      // Past rounds are just as public as the latest one — walk backwards.
      for (let i = 1; i < roundsNeeded; i++) {
        const round = latest.round - i
        if (round < 1) {
          throw new EntropyError('insufficient_entropy', 'drand chain too short for request', {
            provider: INFO.name,
          })
        }
        chunks.push(await randomnessOf((await fetchRound(round, reqOpts?.signal)).signature))
      }
      return { bytes: concatBytes(chunks).slice(0, length), sources: [INFO] }
    },

    stream(streamOpts = {}) {
      return beaconStream(
        async (signal) => {
          const { round, signature } = await fetchRound('latest', signal)
          return { id: round, bytes: await randomnessOf(signature) }
        },
        pollIntervalMs,
        ROUND_BYTES,
        INFO.name,
        streamOpts,
      )
    },
  })
}
