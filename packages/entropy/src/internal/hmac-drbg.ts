import { EntropyError } from '../errors.js'
import { concatBytes } from './bytes.js'

const OUT_LEN = 32
/** SP 800-90A Table 2 (HMAC_DRBG): at most 2¹⁹ bits per generate request. */
export const MAX_BYTES_PER_GENERATE = 2 ** 16
/** SP 800-90A Table 2: reseed_interval ≤ 2⁴⁸ generate requests. */
export const RESEED_INTERVAL = 2 ** 48

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, data))
}

/**
 * NIST SP 800-90A §10.1.2 HMAC_DRBG with SHA-256 (security strength 256),
 * no prediction resistance, no reseeding — a deterministic bit generator:
 * the same seed material and the same sequence of `generate(n)` calls always
 * produce the same bytes. HMAC runs on `crypto.subtle`.
 */
export class HmacDrbg {
  #key: Uint8Array<ArrayBuffer> = new Uint8Array(OUT_LEN)
  #value: Uint8Array<ArrayBuffer> = new Uint8Array(OUT_LEN).fill(1)
  #reseedCounter = 0
  #seedMaterial: Uint8Array<ArrayBuffer> | null
  #ready: Promise<void> | null = null

  /**
   * Instantiate with seed_material = entropyInput ‖ nonce ‖ personalization
   * (§10.1.2.3). The material is copied now and absorbed on the first
   * `generate`.
   */
  constructor(seedMaterial: Uint8Array) {
    this.#seedMaterial = new Uint8Array(seedMaterial)
  }

  /** HMAC_DRBG_Update (§10.1.2.2). */
  async #update(providedData: Uint8Array<ArrayBuffer>): Promise<void> {
    this.#key = await hmac(
      this.#key,
      concatBytes([this.#value, new Uint8Array([0x00]), providedData]),
    )
    this.#value = await hmac(this.#key, this.#value)
    if (providedData.length === 0) return
    this.#key = await hmac(
      this.#key,
      concatBytes([this.#value, new Uint8Array([0x01]), providedData]),
    )
    this.#value = await hmac(this.#key, this.#value)
  }

  /**
   * HMAC_DRBG_Generate (§10.1.2.5) without additional input: `length` bytes
   * (1 … 2¹⁶), followed by the mandatory state update. Callers must serialize
   * calls — concurrent generates would interleave state updates.
   */
  async generate(length: number): Promise<Uint8Array> {
    if (!this.#ready) {
      const material = this.#seedMaterial ?? new Uint8Array(0)
      this.#seedMaterial = null
      this.#ready = this.#update(material).then(() => {
        this.#reseedCounter = 1
      })
    }
    await this.#ready
    if (!(Number.isSafeInteger(length) && length >= 1 && length <= MAX_BYTES_PER_GENERATE)) {
      throw new EntropyError(
        'invalid_request',
        `HMAC_DRBG generate length must be an integer in [1, ${MAX_BYTES_PER_GENERATE}], got ${length}`,
      )
    }
    if (this.#reseedCounter > RESEED_INTERVAL) {
      throw new EntropyError(
        'insufficient_entropy',
        'HMAC_DRBG reseed interval exhausted — instantiate a new generator',
      )
    }
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      this.#key,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const out = new Uint8Array(Math.ceil(length / OUT_LEN) * OUT_LEN)
    for (let offset = 0; offset < length; offset += OUT_LEN) {
      this.#value = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, this.#value))
      out.set(this.#value, offset)
    }
    await this.#update(new Uint8Array(0))
    this.#reseedCounter++
    return out.slice(0, length)
  }
}
