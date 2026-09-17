import { EntropyError } from '../errors.js'
import { base64ToBytes, concatBytes } from '../internal/bytes.js'
import { fetchJson } from '../internal/http.js'
import { type BaseUrlOptions, resolveBaseUrls, withMirrors } from '../internal/mirrors.js'
import { requireTimeoutMs } from '../internal/options.js'
import { defineProvider } from '../internal/provider.js'
import { sleep } from '../internal/rate-limit.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

const INFO: EntropySourceInfo = Object.freeze({ name: 'flow', kind: 'beacon', privacy: 'public' })
const DRAW_BYTES = 8
const DEFAULT_BASE_URL = 'https://rest-mainnet.onflow.org'

const CADENCE_SCRIPT = 'access(all) fun main(): UInt64 { return revertibleRandom<UInt64>() }'
const SCRIPT_B64 = btoa(CADENCE_SCRIPT)
const UINT64_MAX = 0xffff_ffff_ffff_ffffn

export interface FlowBeaconOptions extends BaseUrlOptions {
  fetch?: typeof fetch
  /**
   * Wait between retries when consecutive draws are identical: finite,
   * 0 < ms ≤ 2³¹ − 1. Default 1000.
   */
  retryDelayMs?: number
}

/**
 * Flow protocol randomness via keyless script execution (`revertibleRandom`)
 * on the public access node. PUBLIC crypto-beacon class: 8 bytes per call,
 * re-derived per execution from Flow's DKG random beacon. Rate limits apply
 * on the public node. The UInt64 must be a decimal string in [0, 2⁶⁴ − 1]
 * (`bad_response` otherwise). No round metadata: a script result names no
 * block.
 */
export function flowBeacon(opts: FlowBeaconOptions = {}): EntropyProvider {
  const { fetch: fetchImpl } = opts
  const bases = resolveBaseUrls(opts, [DEFAULT_BASE_URL], INFO.name)
  const retryDelayMs = requireTimeoutMs(opts.retryDelayMs ?? 1000, 'retryDelayMs', INFO.name)

  async function fetchDraw(signal?: AbortSignal): Promise<bigint> {
    // The response is DOUBLE-encoded: a JSON string containing base64 of a
    // JSON-Cadence value (plus a trailing newline).
    const outer = await withMirrors(bases, (base) =>
      fetchJson<unknown>(`${base}/v1/scripts?block_height=sealed`, {
        provider: INFO.name,
        method: 'POST',
        body: { script: SCRIPT_B64, arguments: [] },
        signal,
        fetchImpl,
      }),
    )
    if (typeof outer !== 'string') {
      throw new EntropyError('bad_response', 'expected a base64 script result', {
        provider: INFO.name,
      })
    }
    try {
      const inner = new TextDecoder().decode(base64ToBytes(outer)).trim()
      const cadence = JSON.parse(inner) as { value?: unknown; type?: unknown }
      if (cadence.type !== 'UInt64' || typeof cadence.value !== 'string') {
        throw new Error(`unexpected Cadence value of type ${cadence.type}`)
      }
      if (!/^\d+$/.test(cadence.value)) throw new Error('UInt64 is not a decimal string')
      const draw = BigInt(cadence.value)
      if (draw > UINT64_MAX) throw new Error('UInt64 out of range')
      return draw
    } catch (error) {
      if (error instanceof EntropyError) throw error
      throw new EntropyError('bad_response', 'malformed JSON-Cadence payload', {
        provider: INFO.name,
        cause: error,
      })
    }
  }

  function drawToBytes(value: bigint): Uint8Array {
    const out = new Uint8Array(DRAW_BYTES)
    for (let i = 0; i < DRAW_BYTES; i++) {
      out[i] = Number((value >> BigInt(8 * (DRAW_BYTES - 1 - i))) & 0xffn)
    }
    return out
  }

  let lastDraw: bigint | null = null

  async function nextFreshDraw(signal?: AbortSignal): Promise<bigint> {
    while (true) {
      const draw = await fetchDraw(signal)
      if (draw !== lastDraw) {
        lastDraw = draw
        return draw
      }
      // identical consecutive draws — likely the same sealed block; wait it out
      await sleep(retryDelayMs, signal)
    }
  }

  return defineProvider({
    ...INFO,
    defaultChunkBytes: DRAW_BYTES,

    async getBytes(length, reqOpts) {
      const chunks: Uint8Array[] = []
      for (let collected = 0; collected < length; collected += DRAW_BYTES) {
        chunks.push(drawToBytes(await nextFreshDraw(reqOpts?.signal)))
      }
      return { bytes: concatBytes(chunks).slice(0, length), sources: [INFO] }
    },
  })
}
