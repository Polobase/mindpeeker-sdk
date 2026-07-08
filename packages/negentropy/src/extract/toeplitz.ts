import { NegentropyError } from '../errors.js'

/**
 * Seeded Toeplitz-hashing (2-universal) strong extractor over GF(2).
 * T[i][j] = seed bit (i − j) + (n − 1); output yᵢ = ⊕ⱼ T[i][j]·xⱼ.
 * Leftover hash lemma: with input min-entropy ≥ k bits, choosing
 * m ≤ k − 2·log₂(1/ε) output bits puts the output within statistical
 * distance ε of uniform — EVEN IF THE SEED IS PUBLIC (strong extractor;
 * the seed is reusable). The seed must be uniform and independent of the
 * input — never derive it from the stream being extracted.
 */
export interface ToeplitzExtractor {
  readonly inputBits: number
  readonly outputBits: number
  /** Extract from exactly ⌈inputBits/8⌉ bytes (MSB-first; trailing pad bits ignored). */
  extract(input: Uint8Array): Uint8Array
}

/** Leftover-hash-lemma output length: m = ⌊k − 2·log₂(1/ε)⌋. Default ε = 2⁻³². */
export function toeplitzOutputBits(minEntropyBits: number, epsilon = 2 ** -32): number {
  if (!(epsilon > 0 && epsilon < 1)) {
    throw new NegentropyError('invalid_config', `epsilon must be in (0, 1), got ${epsilon}`)
  }
  return Math.floor(minEntropyBits - 2 * Math.log2(1 / epsilon))
}

/** Read bit t (global MSB-first order) from a byte array. */
function bitAt(bytes: Uint8Array, t: number): number {
  return ((bytes[t >> 3] as number) >> (7 - (t & 7))) & 1
}

/** Pack bits[0..count) (MSB-first order) into 32-bit words, bit t at word t>>5, position t&31. */
function packWords(bytes: Uint8Array, count: number): Uint32Array {
  const words = new Uint32Array(Math.ceil(count / 32))
  for (let t = 0; t < count; t++) {
    if (bitAt(bytes, t)) words[t >> 5] = ((words[t >> 5] as number) | (1 << (t & 31))) >>> 0
  }
  return words
}

function parity32(v: number): number {
  let x = v
  x ^= x >>> 16
  x ^= x >>> 8
  x ^= x >>> 4
  x ^= x >>> 2
  x ^= x >>> 1
  return x & 1
}

export function toeplitzExtractor(
  seed: Uint8Array,
  inputBits: number,
  outputBits: number,
): ToeplitzExtractor {
  if (!Number.isInteger(inputBits) || inputBits < 2) {
    throw new NegentropyError(
      'invalid_config',
      `inputBits must be an integer ≥ 2, got ${inputBits}`,
    )
  }
  if (!Number.isInteger(outputBits) || outputBits < 1 || outputBits >= inputBits) {
    throw new NegentropyError(
      'invalid_config',
      `outputBits must be an integer in [1, inputBits), got ${outputBits}`,
    )
  }
  const seedBits = inputBits + outputBits - 1
  const expectedSeedBytes = Math.ceil(seedBits / 8)
  if (seed.length !== expectedSeedBytes) {
    throw new NegentropyError(
      'invalid_config',
      `seed must be exactly ${expectedSeedBytes} bytes (${seedBits} bits), got ${seed.length}`,
    )
  }
  // yᵢ = parity over t of seed[i + t]·xrev[t], xrev[t] = x[n−1−t]: row i of T is a
  // sliding n-bit window of the seed against the reversed input — word-wise below.
  const inputWords = Math.ceil(inputBits / 32)
  const seedWords = packWords(seed, seedBits)
  const lastMask = inputBits % 32 === 0 ? 0xffffffff : (1 << (inputBits % 32)) - 1 // valid bits of the last window word

  return {
    inputBits,
    outputBits,
    extract(input: Uint8Array): Uint8Array {
      if (input.length !== Math.ceil(inputBits / 8)) {
        throw new NegentropyError(
          'invalid_config',
          `input must be exactly ${Math.ceil(inputBits / 8)} bytes, got ${input.length}`,
        )
      }
      // pack reversed input bits into words
      const xrev = new Uint32Array(inputWords)
      for (let t = 0; t < inputBits; t++) {
        if (bitAt(input, inputBits - 1 - t)) {
          xrev[t >> 5] = ((xrev[t >> 5] as number) | (1 << (t & 31))) >>> 0
        }
      }
      const out = new Uint8Array(Math.ceil(outputBits / 8))
      for (let i = 0; i < outputBits; i++) {
        const base = i >> 5
        const off = i & 31
        let acc = 0
        for (let w = 0; w < inputWords; w++) {
          let window = (seedWords[base + w] as number) >>> off
          if (off !== 0) window |= ((seedWords[base + w + 1] ?? 0) as number) << (32 - off)
          window >>>= 0
          if (w === inputWords - 1) window &= lastMask
          acc ^= window & (xrev[w] as number)
        }
        if (parity32(acc)) out[i >> 3] = (out[i >> 3] as number) | (1 << (7 - (i & 7)))
      }
      return out
    },
  }
}
