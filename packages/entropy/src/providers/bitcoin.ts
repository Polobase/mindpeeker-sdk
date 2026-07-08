import { EntropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'
import { fetchJson, fetchText } from '../internal/http.js'
import { defineProvider } from '../internal/provider.js'
import { beaconStream } from '../internal/stream.js'
import { bytesFromHexField } from '../internal/validate.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'bitcoin',
  kind: 'beacon',
  privacy: 'public',
})
const HASH_BYTES = 32
const DEFAULT_BASE_URLS = ['https://blockstream.info/api', 'https://mempool.space/api']
// ~10-minute blocks; poll once a minute.
const DEFAULT_POLL_INTERVAL_MS = 60_000

export interface BitcoinBeaconOptions {
  fetch?: typeof fetch
  baseUrls?: string[]
  pollIntervalMs?: number
}

interface BlockResponse {
  previousblockhash?: unknown
}

/**
 * Bitcoin block hashes as a PUBLIC crypto-beacon. Proof-of-work makes bias
 * expensive (six figures per bit — Bonneau et al., eprint 2015/1015) but not
 * impossible: miners can discard unfavourable blocks. Slow cadence
 * (~10 minutes). Audits and mixing only, never private entropy.
 */
export function bitcoinBeacon(opts: BitcoinBeaconOptions = {}): EntropyProvider {
  const {
    baseUrls = DEFAULT_BASE_URLS,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    fetch: fetchImpl,
  } = opts

  async function withFailover<T>(run: (base: string) => Promise<T>): Promise<T> {
    let lastError: unknown
    for (const base of baseUrls) {
      try {
        return await run(base)
      } catch (error) {
        if (!(error instanceof EntropyError) || error.code === 'aborted') throw error
        lastError = error // try the next mirror
      }
    }
    throw lastError
  }

  function parseHash(hash: string): Uint8Array {
    return bytesFromHexField(hash.trim(), HASH_BYTES, INFO.name)
  }

  async function fetchTip(signal?: AbortSignal): Promise<{ hash: string; bytes: Uint8Array }> {
    return withFailover(async (base) => {
      const text = await fetchText(`${base}/blocks/tip/hash`, {
        provider: INFO.name,
        signal,
        fetchImpl,
      })
      const hash = text.trim()
      return { hash, bytes: parseHash(hash) }
    })
  }

  async function fetchPreviousHash(hash: string, signal?: AbortSignal): Promise<string> {
    return withFailover(async (base) => {
      const res = await fetchJson<BlockResponse>(`${base}/block/${hash}`, {
        provider: INFO.name,
        signal,
        fetchImpl,
      })
      if (typeof res?.previousblockhash !== 'string') {
        throw new EntropyError('bad_response', 'missing previousblockhash', {
          provider: INFO.name,
        })
      }
      return res.previousblockhash
    })
  }

  return defineProvider({
    ...INFO,
    defaultChunkBytes: HASH_BYTES,

    async getBytes(length, reqOpts) {
      const blocksNeeded = Math.ceil(length / HASH_BYTES)
      const tip = await fetchTip(reqOpts?.signal)
      const chunks = [tip.bytes]
      let cursor = tip.hash
      for (let i = 1; i < blocksNeeded; i++) {
        cursor = await fetchPreviousHash(cursor, reqOpts?.signal)
        chunks.push(parseHash(cursor))
      }
      return { bytes: concatBytes(chunks).slice(0, length), sources: [INFO] }
    },

    stream(streamOpts = {}) {
      let lastHash = ''
      let seq = 0
      return beaconStream(
        async (signal) => {
          const tip = await fetchTip(signal)
          if (tip.hash !== lastHash) {
            lastHash = tip.hash
            seq++
          }
          return { id: seq, bytes: tip.bytes }
        },
        pollIntervalMs,
        HASH_BYTES,
        INFO.name,
        streamOpts,
      )
    },
  })
}
