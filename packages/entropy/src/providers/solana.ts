import { EntropyError } from '../errors.js'
import { attribution, beaconRound } from '../internal/beacon.js'
import { concatBytes } from '../internal/bytes.js'
import { base58Decode } from '../internal/encoding.js'
import { fetchJson } from '../internal/http.js'
import { type BaseUrlOptions, resolveBaseUrls, withMirrors } from '../internal/mirrors.js'
import { requireTimeoutMs } from '../internal/options.js'
import { defineProvider } from '../internal/provider.js'
import { sleep } from '../internal/rate-limit.js'
import { beaconStream } from '../internal/stream.js'
import type { BeaconRound, EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'solana',
  kind: 'beacon',
  privacy: 'public',
})
const HASH_BYTES = 32
const DEFAULT_URL = 'https://api.mainnet-beta.solana.com/'
// ~400 ms slots; poll politely.
const DEFAULT_POLL_INTERVAL_MS = 500

export interface SolanaBeaconOptions extends BaseUrlOptions {
  fetch?: typeof fetch
  /** @deprecated Use `baseUrl`. The JSON-RPC endpoint; same as `baseUrl`. */
  url?: string
  /**
   * Stream poll cadence and the wait between repeated slots in `getBytes`:
   * finite, 0 < ms ≤ 2³¹ − 1 (0 used to busy-loop). Default 500.
   */
  pollIntervalMs?: number
}

interface RpcResponse {
  result?: { context?: { slot?: unknown }; value?: { blockhash?: unknown } }
}

/**
 * Solana latest blockhash as a PUBLIC crypto-beacon (fast ~400 ms slots).
 * The slot leader influences block content, so treat it like every other
 * chain beacon: auditable public randomness, never private entropy. Results
 * carry `{ round: slot }` per blockhash; there is no keyless historical
 * route, so no `getRound`.
 */
export function solanaBeacon(opts: SolanaBeaconOptions = {}): EntropyProvider {
  const { fetch: fetchImpl } = opts
  if (opts.url !== undefined && (opts.baseUrl !== undefined || opts.baseUrls !== undefined)) {
    throw new EntropyError('invalid_request', 'pass either url (deprecated) or baseUrl(s)', {
      provider: INFO.name,
    })
  }
  const bases = resolveBaseUrls(
    opts.url !== undefined ? { baseUrl: opts.url } : opts,
    [DEFAULT_URL],
    INFO.name,
  )
  const pollIntervalMs = requireTimeoutMs(
    opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    'pollIntervalMs',
    INFO.name,
  )

  function fetchLatest(signal?: AbortSignal): Promise<{ slot: number; bytes: Uint8Array }> {
    return withMirrors(bases, async (base) => {
      const res = await fetchJson<RpcResponse>(base, {
        provider: INFO.name,
        method: 'POST',
        body: { jsonrpc: '2.0', id: 1, method: 'getLatestBlockhash' },
        signal,
        fetchImpl,
      })
      const slot = res?.result?.context?.slot
      const blockhash = res?.result?.value?.blockhash
      if (!Number.isSafeInteger(slot) || typeof blockhash !== 'string') {
        throw new EntropyError('bad_response', 'missing blockhash/slot', { provider: INFO.name })
      }
      let bytes: Uint8Array
      try {
        bytes = base58Decode(blockhash)
      } catch (error) {
        throw new EntropyError('bad_response', 'invalid base58 blockhash', {
          provider: INFO.name,
          cause: error,
        })
      }
      if (bytes.length !== HASH_BYTES) {
        throw new EntropyError('bad_response', `blockhash decodes to ${bytes.length} bytes`, {
          provider: INFO.name,
        })
      }
      return { slot: slot as number, bytes }
    })
  }

  return defineProvider({
    ...INFO,
    defaultChunkBytes: HASH_BYTES,

    async getBytes(length, reqOpts) {
      // no keyless historical route — aggregate consecutive fresh slots,
      // waiting out repeats (slots are ~400 ms, so this stays cheap)
      const chunks: Uint8Array[] = []
      const rounds: BeaconRound[] = []
      let collected = 0
      let lastSlot = -1
      while (collected < length) {
        const { slot, bytes } = await fetchLatest(reqOpts?.signal)
        if (slot <= lastSlot) {
          await sleep(pollIntervalMs, reqOpts?.signal)
          continue
        }
        lastSlot = slot
        chunks.push(bytes)
        rounds.push(beaconRound(slot))
        collected += bytes.length
      }
      return { bytes: concatBytes(chunks).slice(0, length), sources: [attribution(INFO, rounds)] }
    },

    stream(streamOpts = {}) {
      return beaconStream(
        async (signal) => {
          const { slot, bytes } = await fetchLatest(signal)
          return { id: slot, bytes }
        },
        pollIntervalMs,
        INFO.name,
        streamOpts,
      )
    },
  })
}
