import { EntropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'
import { cidDigest } from '../internal/encoding.js'
import { fetchJson } from '../internal/http.js'
import { defineProvider } from '../internal/provider.js'
import { beaconStream } from '../internal/stream.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'curby',
  kind: 'beacon',
  privacy: 'public',
})
const PULSE_BYTES = 32
const DEFAULT_BASE_URLS = ['https://api.entwine.me', 'https://random.colorado.edu/api']
// The CURBy-RNG chain (classical, 60 s cadence). The quantum CURBy-Q chain is
// deliberately NOT used: it has been stalled since 2025-08 (same round for
// months) while this chain keeps pulsing.
const CURBY_RNG_CHAIN_CID =
  'bafyriqci6f3st2mg7gq733ho4zvvth32zpy2mtiylixwmhoz6d627eo3jfpmbxepe54u2zdvymonq5sp3armtm4rodxsynsirr5g3xsbd3q4s'
const DEFAULT_POLL_INTERVAL_MS = 60_000
const DEFAULT_MAX_STALENESS_MS = 3 * 60_000

export interface CurbyOptions {
  fetch?: typeof fetch
  baseUrls?: string[]
  /** Twine chain CID. Default: the CURBy-RNG chain. */
  chainCid?: string
  pollIntervalMs?: number
  /** Reject pulses older than this — guards against a stalled spool. Default 180_000. */
  maxStalenessMs?: number
}

interface TwineBlock {
  cid?: unknown
  data?: { content?: { index?: unknown; payload?: { timestamp?: unknown } } }
}

/**
 * CURBy (CU Boulder + NIST) randomness beacon over the Twine protocol. The
 * per-pulse randomness is defined as the block CID's multihash digest.
 * PUBLIC randomness with a built-in freshness guard.
 */
export function curby(opts: CurbyOptions = {}): EntropyProvider {
  const {
    baseUrls = DEFAULT_BASE_URLS,
    chainCid = CURBY_RNG_CHAIN_CID,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    maxStalenessMs = DEFAULT_MAX_STALENESS_MS,
    fetch: fetchImpl,
  } = opts

  function parseBlock(block: TwineBlock): { index: number; timestamp: number; bytes: Uint8Array } {
    const rawCid = block?.cid
    const cidString =
      typeof rawCid === 'string' ? rawCid : (rawCid as { '/'?: unknown } | undefined)?.['/']
    const index = block?.data?.content?.index
    const timestampRaw = block?.data?.content?.payload?.timestamp
    const timestamp = typeof timestampRaw === 'string' ? Date.parse(timestampRaw) : Number.NaN
    if (typeof cidString !== 'string' || !Number.isInteger(index) || Number.isNaN(timestamp)) {
      throw new EntropyError('bad_response', 'malformed twine block', { provider: INFO.name })
    }
    let digest: Uint8Array
    try {
      digest = cidDigest(cidString)
    } catch (error) {
      throw new EntropyError('bad_response', 'undecodable block CID', {
        provider: INFO.name,
        cause: error,
      })
    }
    // The CURBy-RNG chain uses 64-byte (sha2-512) digests; other twine chains
    // may differ, so accept any reasonable multihash digest size.
    if (digest.length < 16) {
      throw new EntropyError('bad_response', `digest too short (${digest.length} bytes)`, {
        provider: INFO.name,
      })
    }
    return { index: index as number, timestamp, bytes: digest }
  }

  async function fetchPulse(
    which: 'latest' | number,
    signal?: AbortSignal,
  ): Promise<{ index: number; timestamp: number; bytes: Uint8Array }> {
    let lastError: unknown
    for (const base of baseUrls) {
      try {
        const block = await fetchJson<TwineBlock>(`${base}/chains/${chainCid}/pulses/${which}`, {
          provider: INFO.name,
          signal,
          fetchImpl,
        })
        return parseBlock(block)
      } catch (error) {
        if (!(error instanceof EntropyError) || error.code === 'aborted') throw error
        lastError = error // try the next mirror
      }
    }
    throw lastError
  }

  async function fetchFreshLatest(signal?: AbortSignal) {
    const pulse = await fetchPulse('latest', signal)
    if (Date.now() - pulse.timestamp > maxStalenessMs) {
      throw new EntropyError(
        'bad_response',
        `chain stale — latest pulse is ${Math.round((Date.now() - pulse.timestamp) / 1000)}s old`,
        { provider: INFO.name },
      )
    }
    return pulse
  }

  return defineProvider({
    ...INFO,
    defaultChunkBytes: PULSE_BYTES,

    async getBytes(length, reqOpts) {
      const latest = await fetchFreshLatest(reqOpts?.signal)
      const chunks = [latest.bytes]
      let collected = latest.bytes.length
      // Walk prior pulses until we have enough, adapting to the chain's actual
      // digest size (learned from the latest block).
      for (let i = 1; collected < length; i++) {
        const index = latest.index - i
        if (index < 1) {
          throw new EntropyError('insufficient_entropy', 'chain too short for request', {
            provider: INFO.name,
          })
        }
        // verify-live: latest is research-verified; by-index follows the
        // documented twine pattern and is exercised by LIVE=1 runs
        const prior = await fetchPulse(index, reqOpts?.signal)
        chunks.push(prior.bytes)
        collected += prior.bytes.length
      }
      return { bytes: concatBytes(chunks).slice(0, length), sources: [INFO] }
    },

    stream(streamOpts = {}) {
      return beaconStream(
        async (signal) => {
          const pulse = await fetchFreshLatest(signal)
          return { id: pulse.index, bytes: pulse.bytes }
        },
        pollIntervalMs,
        PULSE_BYTES,
        INFO.name,
        streamOpts,
      )
    },
  })
}
