import { bigIntToBytes, byteLength, bytesToBigInt, u32be } from './internal/bigint.js'
import { assertModulus, assertT, toBytes } from './internal/validate.js'
import type { RsaModulus } from './types.js'

/**
 * Domain-separation tag opening every SHA-256 transcript in this package.
 * Changing it (or any field encoding below) is a protocol break: proofs
 * produced under one tag never verify under another.
 */
export const DOMAIN_TAG = 'mindpeeker-vdf-v1'

const encoder = new TextEncoder()
const TAG_BYTES = encoder.encode(DOMAIN_TAG)
const GROUP_CONTEXT = encoder.encode('group')
const CHALLENGE_CONTEXT = encoder.encode('challenge')

/** SHA-256 via WebCrypto — the only cryptographic primitive used, keeping the package browser-safe. */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource))
}

/** `LP(f)` — a length-prefixed field: 4 big-endian length bytes, then the bytes themselves. */
function lengthPrefixed(field: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + field.length)
  out.set(u32be(field.length), 0)
  out.set(field, 4)
  return out
}

/**
 * Transcript encoding used for every hash in the package:
 *
 * $$\mathrm{transcript} = LP(\texttt{'mindpeeker-vdf-v1'}) \,\|\, LP(\mathrm{context})
 *   \,\|\, LP(f_1) \,\|\, \dots \,\|\, LP(f_k)$$
 *
 * where `LP(f)` is a 4-byte big-endian length followed by the field bytes.
 * Length prefixes make the encoding injective (no field-boundary ambiguity);
 * the context string separates the group-mapping hash from Fiat–Shamir
 * challenges.
 */
function transcript(context: Uint8Array, fields: readonly Uint8Array[]): Uint8Array {
  const parts = [lengthPrefixed(TAG_BYTES), lengthPrefixed(context)]
  for (const field of fields) parts.push(lengthPrefixed(field))
  let total = 0
  for (const part of parts) total += part.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/**
 * Map arbitrary bytes to a quadratic residue: $x = H'(\mathrm{input})^2 \bmod n$.
 *
 * $H'$ is counter-mode SHA-256 expansion to the modulus width
 * $w = \lceil \mathrm{bitLength}(n)/8 \rceil$ bytes, reduced mod $n$:
 *
 * $$H'(m) = \mathrm{BE}\Big(\big\|_{i=0}^{\lceil w/32 \rceil - 1}
 *   \mathrm{SHA256}\big(LP(\mathrm{tag}) \| LP(\texttt{'group'}) \| LP(m)
 *   \| LP(\mathrm{u32be}(i))\big)\Big)[0..w) \bmod n$$
 *
 * The final squaring lands the result in $QR_n$, dodging low-order elements:
 * $-1$ and other small-order elements of $\mathbb{Z}_n^\times$ would let a
 * cheating prover shift intermediate values undetectably, whereas for
 * $n = pq$ with $p, q$ safe primes, $QR_n$ is cyclic of odd order
 * $\varphi(n)/4$ with no low-order elements besides 1 (Pietrzak, ITCS 2019,
 * §"working in $QR_n$").
 *
 * The expansion is truncated to exactly the modulus width $w$ before `% n`, so
 * the reduction is NOT statistically uniform: since $2^{8w} < 2n$, residues
 * below $2^{8w} \bmod n$ get two preimages and the rest one — a ~2× point-
 * probability skew over the low $(2^{8w} \bmod n)/n$ fraction of $\mathbb{Z}_n$
 * (for RSA-2048, $2^{2048}/n \approx 1.28$, so the bottom ~28% of residues are
 * ~2× likelier). This is deliberate and harmless: $x$ is public, non-secret,
 * and sequentiality/soundness require only that $x \in QR_n$, not that it be
 * uniform. If a near-uniform map is ever needed, expand to
 * $\mathrm{bitLength}(n) + 64$ bits before reducing.
 */
export async function hashToGroup(
  input: Uint8Array | ArrayLike<number>,
  modulus: RsaModulus,
): Promise<bigint> {
  const n = assertModulus(modulus)
  const bytes = toBytes(input, 'input')
  const width = byteLength(n)
  const blockCount = Math.ceil(width / 32)
  const expanded = new Uint8Array(blockCount * 32)
  for (let i = 0; i < blockCount; i++) {
    const block = await sha256(transcript(GROUP_CONTEXT, [bytes, u32be(i)]))
    expanded.set(block, i * 32)
  }
  const h = bytesToBigInt(expanded.subarray(0, width)) % n
  return (h * h) % n
}

/**
 * Fiat–Shamir challenge for one halving round, binding the whole round state:
 *
 * $$r_i = \mathrm{BE}\Big(\mathrm{SHA256}\big(LP(\mathrm{tag}) \|
 *   LP(\texttt{'challenge'}) \| LP(x_i) \| LP(y_i) \| LP(\mu_i) \|
 *   LP(\mathrm{u32be}(T_i))\big)[0..16)\Big) \in [0, 2^{128})$$
 *
 * $x_i, y_i, \mu_i$ are fixed-width big-endian at the modulus byte length;
 * $y_i$ is the value at round *start* (before the odd-$T$ squaring). 128 bits
 * follow Pietrzak's analysis: soundness error per round is
 * $\approx 3/2^{\lambda}$ for a $\lambda$-bit prime-free challenge when the
 * group has no low-order elements, and $\log_2 T$ rounds keep the union bound
 * far below $2^{-100}$ for any practical $T$.
 */
export async function fiatShamirChallenge(
  x: bigint,
  y: bigint,
  mu: bigint,
  T: number,
  modulus: RsaModulus,
): Promise<bigint> {
  const n = assertModulus(modulus)
  assertT(T)
  const width = byteLength(n)
  const digest = await sha256(
    transcript(CHALLENGE_CONTEXT, [
      bigIntToBytes(x, width),
      bigIntToBytes(y, width),
      bigIntToBytes(mu, width),
      u32be(T),
    ]),
  )
  return bytesToBigInt(digest.subarray(0, 16))
}
