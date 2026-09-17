import { EntropyError } from '../errors.js'
import { attribution, beaconRound, defineBeacon, roundResult } from '../internal/beacon.js'
import { concatBytes } from '../internal/bytes.js'
import { base58Decode } from '../internal/encoding.js'
import { fetchJson } from '../internal/http.js'
import { type BaseUrlOptions, resolveBaseUrls, withMirrors } from '../internal/mirrors.js'
import { requireTimeoutMs } from '../internal/options.js'
import { beaconStream } from '../internal/stream.js'
import type { BeaconProvider, BeaconRound, EntropySourceInfo } from '../types.js'

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

export interface TezosBeaconOptions extends BaseUrlOptions {
  fetch?: typeof fetch
  /** Stream poll cadence: finite, 0 < ms ≤ 2³¹ − 1. Default 10 000. */
  pollIntervalMs?: number
}

interface HeadResponse {
  hash?: unknown
  level?: unknown
  timestamp?: unknown
}

interface Block {
  level: number
  bytes: Uint8Array
  round: BeaconRound
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
 * baker influence. Auditable public randomness only. Results carry `{ round:
 * level, timestamp }` per block; `getRound(level)` fetches a block by level
 * and every historical block is checked to be the level requested.
 */
export function tezosBeacon(opts: TezosBeaconOptions = {}): BeaconProvider {
  const { fetch: fetchImpl } = opts
  const bases = resolveBaseUrls(opts, [DEFAULT_BASE_URL], INFO.name)
  const pollIntervalMs = requireTimeoutMs(
    opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    'pollIntervalMs',
    INFO.name,
  )

  function fetchBlock(which: 'head' | number, signal: AbortSignal): Promise<Block> {
    const path = which === 'head' ? '/v1/head' : `/v1/blocks/${which}`
    return withMirrors(bases, async (base) => {
      const res = await fetchJson<HeadResponse>(`${base}${path}`, {
        provider: INFO.name,
        signal,
        fetchImpl,
      })
      if (typeof res?.hash !== 'string' || !Number.isSafeInteger(res?.level)) {
        throw new EntropyError('bad_response', 'missing block hash/level', { provider: INFO.name })
      }
      const level = res.level as number
      if (which !== 'head' && level !== which) {
        throw new EntropyError('bad_response', `requested level ${which}, got ${level}`, {
          provider: INFO.name,
        })
      }
      const timestamp = typeof res.timestamp === 'string' ? Date.parse(res.timestamp) : undefined
      return {
        level,
        bytes: await decodeBlockHash(res.hash),
        round: beaconRound(level, { timestamp }),
      }
    })
  }

  return defineBeacon({
    ...INFO,
    defaultChunkBytes: HASH_BYTES,
    minRound: 0,

    async getBytes(length, reqOpts) {
      const signal = reqOpts?.signal as AbortSignal
      const blocksNeeded = Math.ceil(length / HASH_BYTES)
      const head = await fetchBlock('head', signal)
      const blocks = [head]
      for (let i = 1; i < blocksNeeded; i++) {
        const level = head.level - i
        if (level < 1) {
          throw new EntropyError('insufficient_entropy', 'not enough blocks for request', {
            provider: INFO.name,
          })
        }
        blocks.push(await fetchBlock(level, signal))
      }
      return {
        bytes: concatBytes(blocks.map((b) => b.bytes)).slice(0, length),
        sources: [
          attribution(
            INFO,
            blocks.map((b) => b.round),
          ),
        ],
      }
    },

    async getRound(level, { signal }) {
      const block = await fetchBlock(level, signal)
      return roundResult(INFO, block.round, block.bytes)
    },

    stream(streamOpts = {}) {
      return beaconStream(
        async (signal) => {
          const head = await fetchBlock('head', signal)
          return { id: head.level, bytes: head.bytes }
        },
        pollIntervalMs,
        INFO.name,
        streamOpts,
      )
    },
  })
}
