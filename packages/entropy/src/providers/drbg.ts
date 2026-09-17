import { EntropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'
import { HmacDrbg, MAX_BYTES_PER_GENERATE } from '../internal/hmac-drbg.js'
import { defineProvider } from '../internal/provider.js'
import { sha256 } from '../internal/sha256.js'
import type { EntropyProvider, EntropySourceInfo } from '../types.js'

export interface DrbgOptions {
  /**
   * Seed material: SP 800-90A entropy_input ‖ nonce, at least 32 bytes. For a
   * conforming 256-bit instantiation pass ≥ 48 bytes (a 256-bit entropy input
   * plus a 128-bit nonce). Copied at construction.
   */
  seed: Uint8Array
  /** Optional personalization string (bytes, or text encoded as UTF-8). */
  personalization?: Uint8Array | string
}

const MIN_SEED_BYTES = 32

function hex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/**
 * Deterministic CSPRNG for control runs and exact replay: NIST SP 800-90A
 * HMAC_DRBG (SHA-256, `crypto.subtle` HMAC), instantiated from
 * `seed ‖ personalization`, without reseeding or prediction resistance.
 *
 * One provider is one DRBG instance: `getBytes` calls and stream pulls advance
 * the same state in call order (concurrent calls are serialized), and each
 * request of n bytes performs ⌈n / 65 536⌉ SP 800-90A generate calls. The
 * bytes therefore depend on the seed AND on the sequence of request sizes —
 * replay by creating a new provider from the same seed and repeating the same
 * requests (e.g. the same `stream({ chunkBytes })`). A request aborted before
 * its turn does not advance the state; one interrupted mid-generation may.
 *
 * `kind: 'csprng'`, named `hmac-drbg(seed:<first 4 bytes of SHA-256(seed)>)`
 * so attribution shows the bytes are synthetic and which seed made them.
 * Anyone holding the seed can reproduce every output: never use a recorded
 * seed to protect secrets. Throws `EntropyError('invalid_request')` for a seed
 * shorter than 32 bytes or a non-bytes/non-string personalization.
 */
export function drbgProvider(opts: DrbgOptions): EntropyProvider {
  const { seed, personalization } = opts ?? ({} as DrbgOptions)
  if (!(seed instanceof Uint8Array) || seed.length < MIN_SEED_BYTES) {
    throw new EntropyError(
      'invalid_request',
      `drbgProvider: seed must be a Uint8Array of at least ${MIN_SEED_BYTES} bytes`,
      { provider: 'hmac-drbg' },
    )
  }
  let personal: Uint8Array
  if (personalization === undefined) personal = new Uint8Array(0)
  else if (typeof personalization === 'string') {
    personal = new TextEncoder().encode(personalization)
  } else if (personalization instanceof Uint8Array) personal = personalization
  else {
    throw new EntropyError(
      'invalid_request',
      'drbgProvider: personalization must be a Uint8Array or a string',
      { provider: 'hmac-drbg' },
    )
  }

  const info: EntropySourceInfo = Object.freeze({
    name: `hmac-drbg(seed:${hex(sha256(seed).subarray(0, 4))})`,
    kind: 'csprng',
    privacy: 'private',
  })
  const drbg = new HmacDrbg(concatBytes([seed, personal]))
  let tail: Promise<unknown> = Promise.resolve()

  return defineProvider({
    ...info,
    async getBytes(length, reqOpts) {
      const run = tail.then(async () => {
        if (reqOpts?.signal?.aborted) {
          throw new EntropyError('aborted', 'request aborted before generation', {
            provider: info.name,
          })
        }
        const parts: Uint8Array[] = []
        for (let done = 0; done < length; done += MAX_BYTES_PER_GENERATE) {
          parts.push(await drbg.generate(Math.min(MAX_BYTES_PER_GENERATE, length - done)))
        }
        return concatBytes(parts)
      })
      tail = run.catch(() => {})
      return { bytes: await run, sources: [info] }
    },
  })
}
