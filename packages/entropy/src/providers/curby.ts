import { EntropyError } from '../errors.js'
import { attribution, beaconRound, defineBeacon, roundResult } from '../internal/beacon.js'
import { concatBytes } from '../internal/bytes.js'
import { cidMultihash } from '../internal/encoding.js'
import { fetchJson } from '../internal/http.js'
import { type BaseUrlOptions, resolveBaseUrls, withMirrors } from '../internal/mirrors.js'
import { requireTimeoutMs } from '../internal/options.js'
import { beaconStream } from '../internal/stream.js'
import type { BeaconProvider, BeaconRound, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({
  name: 'curby',
  kind: 'beacon',
  privacy: 'public',
})
const DEFAULT_BASE_URLS = Object.freeze([
  'https://api.entwine.me',
  'https://random.colorado.edu/api',
])
// The CURBy-RNG chain (classical, 60 s cadence). The quantum CURBy-Q chain is
// deliberately NOT used: it has been stalled since 2025-08 (same round for
// months) while this chain keeps pulsing.
const CURBY_RNG_CHAIN_CID =
  'bafyriqci6f3st2mg7gq733ho4zvvth32zpy2mtiylixwmhoz6d627eo3jfpmbxepe54u2zdvymonq5sp3armtm4rodxsynsirr5g3xsbd3q4s'
const DEFAULT_POLL_INTERVAL_MS = 60_000
const DEFAULT_MAX_STALENESS_MS = 3 * 60_000
/** Shortest digest accepted from a twine chain. */
const MIN_DIGEST_BYTES = 16

export interface CurbyOptions extends BaseUrlOptions {
  fetch?: typeof fetch
  /** Twine chain CID (base32 CIDv1). Default: the CURBy-RNG chain. */
  chainCid?: string
  /** Stream poll cadence: finite, 0 < ms ≤ 2³¹ − 1. Default 60 000. */
  pollIntervalMs?: number
  /**
   * Reject latest pulses older than this — guards against a stalled spool
   * (finite, 0 < ms ≤ 2³¹ − 1). Default 180_000. Not applied to `getRound`.
   */
  maxStalenessMs?: number
}

interface TwineBlock {
  cid?: unknown
  data?: {
    content?: { chain?: unknown; index?: unknown; payload?: { timestamp?: unknown } }
    signature?: unknown
  }
}

interface Pulse {
  index: number
  timestamp: number
  bytes: Uint8Array
  round: BeaconRound
}

function linkString(link: unknown): unknown {
  return typeof link === 'string' ? link : (link as { '/'?: unknown } | undefined)?.['/']
}

/**
 * CURBy (CU Boulder + NIST) randomness beacon over the Twine protocol. This
 * provider takes the block CID's multihash digest as the pulse value — on the
 * CURBy-RNG chain a 64-byte sha3-512 (multihash 0x14) hash of the signed
 * block. That derivation is the library's choice: CURBy's own definition of
 * its certified random output (the pulse payload carries `pre`/`salt`) is not
 * confirmed, and the block's JWS signature is not verified. PUBLIC randomness
 * with a built-in freshness guard; results carry `{ round, timestamp,
 * signature }` per pulse and `getRound(index)` fetches a pulse by index.
 */
export function curby(opts: CurbyOptions = {}): BeaconProvider {
  const { chainCid = CURBY_RNG_CHAIN_CID, fetch: fetchImpl } = opts
  if (typeof chainCid !== 'string' || !/^b[a-z2-7]+$/.test(chainCid)) {
    throw new EntropyError('invalid_request', 'chainCid must be a base32 CIDv1 string', {
      provider: INFO.name,
    })
  }
  const bases = resolveBaseUrls(opts, DEFAULT_BASE_URLS, INFO.name)
  const pollIntervalMs = requireTimeoutMs(
    opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    'pollIntervalMs',
    INFO.name,
  )
  const maxStalenessMs = requireTimeoutMs(
    opts.maxStalenessMs ?? DEFAULT_MAX_STALENESS_MS,
    'maxStalenessMs',
    INFO.name,
  )

  function malformed(message: string, cause?: unknown): EntropyError {
    return new EntropyError('bad_response', message, { provider: INFO.name, cause })
  }

  function parseBlock(block: TwineBlock): Pulse {
    const cidString = linkString(block?.cid)
    const content = block?.data?.content
    const index = content?.index
    const timestampRaw = content?.payload?.timestamp
    const timestamp = typeof timestampRaw === 'string' ? Date.parse(timestampRaw) : Number.NaN
    if (typeof cidString !== 'string' || !Number.isSafeInteger(index) || Number.isNaN(timestamp)) {
      throw malformed('malformed twine block')
    }
    const chain = linkString(content?.chain)
    if (chain !== undefined && chain !== chainCid) {
      throw malformed(
        `block belongs to chain ${String(chain).slice(0, 16)}…, not the requested one`,
      )
    }
    let digest: Uint8Array
    try {
      digest = cidMultihash(cidString).digest
    } catch (error) {
      throw malformed('undecodable block CID', error)
    }
    if (digest.length < MIN_DIGEST_BYTES) {
      throw malformed(`digest too short (${digest.length} bytes)`)
    }
    return {
      index: index as number,
      timestamp,
      bytes: digest,
      round: beaconRound(index as number, { timestamp, signature: block?.data?.signature }),
    }
  }

  function fetchPulse(which: 'latest' | number, signal: AbortSignal): Promise<Pulse> {
    return withMirrors(bases, async (base) => {
      const block = await fetchJson<TwineBlock>(`${base}/chains/${chainCid}/pulses/${which}`, {
        provider: INFO.name,
        signal,
        fetchImpl,
      })
      const pulse = parseBlock(block)
      if (which !== 'latest' && pulse.index !== which) {
        throw malformed(`requested pulse ${which}, got ${pulse.index}`)
      }
      return pulse
    })
  }

  async function fetchFreshLatest(signal: AbortSignal): Promise<Pulse> {
    const pulse = await fetchPulse('latest', signal)
    if (Date.now() - pulse.timestamp > maxStalenessMs) {
      throw malformed(
        `chain stale — latest pulse is ${Math.round((Date.now() - pulse.timestamp) / 1000)}s old`,
      )
    }
    return pulse
  }

  return defineBeacon({
    ...INFO,
    defaultChunkBytes: 64,

    async getBytes(length, reqOpts) {
      const signal = reqOpts?.signal as AbortSignal
      const latest = await fetchFreshLatest(signal)
      const pulses = [latest]
      let collected = latest.bytes.length
      // Walk prior pulses until we have enough; digest sizes come from the
      // blocks themselves, never from an assumed constant.
      for (let i = 1; collected < length; i++) {
        const index = latest.index - i
        if (index < 1) {
          throw new EntropyError('insufficient_entropy', 'chain too short for request', {
            provider: INFO.name,
          })
        }
        const prior = await fetchPulse(index, signal)
        pulses.push(prior)
        collected += prior.bytes.length
      }
      return {
        bytes: concatBytes(pulses.map((p) => p.bytes)).slice(0, length),
        sources: [
          attribution(
            INFO,
            pulses.map((p) => p.round),
          ),
        ],
      }
    },

    async getRound(index, { signal }) {
      const pulse = await fetchPulse(index, signal)
      return roundResult(INFO, pulse.round, pulse.bytes)
    },

    stream(streamOpts = {}) {
      return beaconStream(
        async (signal) => {
          const pulse = await fetchFreshLatest(signal)
          return { id: pulse.index, bytes: pulse.bytes }
        },
        pollIntervalMs,
        INFO.name,
        streamOpts,
      )
    },
  })
}
