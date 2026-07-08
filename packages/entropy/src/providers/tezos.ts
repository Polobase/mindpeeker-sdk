import { EntropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'
import { base58Decode } from '../internal/encoding.js'
import { fetchJson } from '../internal/http.js'
import { defineProvider } from '../internal/provider.js'
import { beaconStream } from '../internal/stream.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'tezos',
  kind: 'beacon',
  privacy: 'public',
})
const HASH_BYTES = 32
const PREFIX_BYTES = 2 // Tezos block hashes: base58check payload starts [1, 52]
const CHECKSUM_BYTES = 4
const DEFAULT_BASE_URL = 'https://api.tzkt.io'
// ~8 s blocks.
const DEFAULT_POLL_INTERVAL_MS = 10_000

export interface TezosBeaconOptions {
  fetch?: typeof fetch
  baseUrl?: string
  pollIntervalMs?: number
}

interface HeadResponse {
  hash?: unknown
  level?: unknown
}

/** base58check-decode a Tezos block hash and return its 32 payload bytes. */
async function decodeBlockHash(hash: string): Promise<Uint8Array> {
  let full: Uint8Array
  try {
    full = base58Decode(hash)
  } catch (error) {
    throw new EntropyError('bad_response', 'invalid base58 block hash', {
      provider: INFO.name,
      cause: error,
    })
  }
  if (full.length !== PREFIX_BYTES + HASH_BYTES + CHECKSUM_BYTES) {
    throw new EntropyError('bad_response', `block hash decodes to ${full.length} bytes`, {
      provider: INFO.name,
    })
  }
  const payload = full.slice(0, PREFIX_BYTES + HASH_BYTES)
  const checksum = full.slice(PREFIX_BYTES + HASH_BYTES)
  const first = new Uint8Array(await crypto.subtle.digest('SHA-256', payload))
  const second = new Uint8Array(await crypto.subtle.digest('SHA-256', first))
  for (let i = 0; i < CHECKSUM_BYTES; i++) {
    if (checksum[i] !== second[i]) {
      throw new EntropyError('bad_response', 'block hash checksum mismatch', {
        provider: INFO.name,
      })
    }
  }
  return payload.slice(PREFIX_BYTES)
}

/**
 * Tezos head block hashes as a PUBLIC crypto-beacon, read through the TzKT
 * indexer — note the extra trust in a third-party indexer on top of the usual
 * baker influence. Auditable public randomness only.
 */
export function tezosBeacon(opts: TezosBeaconOptions = {}): EntropyProvider {
  const {
    baseUrl = DEFAULT_BASE_URL,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    fetch: fetchImpl,
  } = opts

  async function fetchBlock(
    path: string,
    signal?: AbortSignal,
  ): Promise<{ level: number; bytes: Uint8Array }> {
    const res = await fetchJson<HeadResponse>(`${baseUrl}${path}`, {
      provider: INFO.name,
      signal,
      fetchImpl,
    })
    if (typeof res?.hash !== 'string' || !Number.isInteger(res?.level)) {
      throw new EntropyError('bad_response', 'missing block hash/level', { provider: INFO.name })
    }
    return { level: res.level as number, bytes: await decodeBlockHash(res.hash) }
  }

  return defineProvider({
    ...INFO,
    defaultChunkBytes: HASH_BYTES,

    async getBytes(length, reqOpts) {
      const blocksNeeded = Math.ceil(length / HASH_BYTES)
      const head = await fetchBlock('/v1/head', reqOpts?.signal)
      const chunks = [head.bytes]
      for (let i = 1; i < blocksNeeded; i++) {
        const level = head.level - i
        if (level < 1) {
          throw new EntropyError('insufficient_entropy', 'not enough blocks for request', {
            provider: INFO.name,
          })
        }
        chunks.push((await fetchBlock(`/v1/blocks/${level}`, reqOpts?.signal)).bytes)
      }
      return { bytes: concatBytes(chunks).slice(0, length), sources: [INFO] }
    },

    stream(streamOpts = {}) {
      return beaconStream(
        async (signal) => {
          const head = await fetchBlock('/v1/head', signal)
          return { id: head.level, bytes: head.bytes }
        },
        pollIntervalMs,
        HASH_BYTES,
        INFO.name,
        streamOpts,
      )
    },
  })
}
