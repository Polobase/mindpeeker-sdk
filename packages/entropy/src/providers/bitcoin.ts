import { EntropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'
import { fetchJson, fetchText } from '../internal/http.js'
import { type BaseUrlOptions, resolveBaseUrls, withMirrors } from '../internal/mirrors.js'
import { requireTimeoutMs } from '../internal/options.js'
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
const DEFAULT_BASE_URLS = Object.freeze([
  'https://blockstream.info/api',
  'https://mempool.space/api',
])
// ~10-minute blocks; poll once a minute.
const DEFAULT_POLL_INTERVAL_MS = 60_000
const HASH_RE = /^[0-9a-f]{64}$/i

export interface BitcoinBeaconOptions extends BaseUrlOptions {
  fetch?: typeof fetch
  /** Stream poll cadence: finite, 0 < ms ≤ 2³¹ − 1. Default 60 000. */
  pollIntervalMs?: number
}

interface BlockResponse {
  id?: unknown
  previousblockhash?: unknown
}

/**
 * Bitcoin block hashes as a PUBLIC crypto-beacon. Proof-of-work makes bias
 * expensive (six figures per bit — Bonneau et al., eprint 2015/1015) but not
 * impossible: miners can discard unfavourable blocks. Slow cadence
 * (~10 minutes). Audits and mixing only, never private entropy. Walking back
 * checks that every fetched block is the one requested. Results carry no
 * round metadata (the tip endpoint serves no height).
 */
export function bitcoinBeacon(opts: BitcoinBeaconOptions = {}): EntropyProvider {
  const { fetch: fetchImpl } = opts
  const bases = resolveBaseUrls(opts, DEFAULT_BASE_URLS, INFO.name)
  const pollIntervalMs = requireTimeoutMs(
    opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    'pollIntervalMs',
    INFO.name,
  )

  function parseHash(hash: string): Uint8Array {
    return bytesFromHexField(hash.trim(), HASH_BYTES, INFO.name)
  }

  async function fetchTip(signal?: AbortSignal): Promise<{ hash: string; bytes: Uint8Array }> {
    return withMirrors(bases, async (base) => {
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
    return withMirrors(bases, async (base) => {
      const res = await fetchJson<BlockResponse>(`${base}/block/${hash}`, {
        provider: INFO.name,
        signal,
        fetchImpl,
      })
      if (typeof res?.id !== 'string' || res.id.toLowerCase() !== hash.toLowerCase()) {
        throw new EntropyError('bad_response', `requested block ${hash}, got ${String(res?.id)}`, {
          provider: INFO.name,
        })
      }
      if (typeof res.previousblockhash !== 'string' || !HASH_RE.test(res.previousblockhash)) {
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
        INFO.name,
        streamOpts,
      )
    },
  })
}
