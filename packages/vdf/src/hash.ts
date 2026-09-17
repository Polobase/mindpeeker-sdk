import { VdfError } from './errors.js'
import { bigIntToBytes, byteLength, bytesToBigInt, u32be } from './internal/bigint.js'
import { canon } from './internal/group.js'
import { isProbablePrime } from './internal/primes.js'
import { sha256 } from './internal/sha256.js'
import { assertModulus, assertT, toBytes } from './internal/validate.js'
import type { RsaModulus } from './types.js'

/**
 * Domain-separation tag opening every SHA-256 transcript in this package.
 * Changing it (or any field encoding below) is a protocol break: proofs
 * produced under one tag never verify under another. `v2` (0.2.0) introduced
 * canonical $QR_n^+$ elements and binds the modulus into every transcript.
 */
export const DOMAIN_TAG = 'mindpeeker-vdf-v2'

/** Bytes in a modulus fingerprint (see {@link modulusFingerprint}). */
export const FINGERPRINT_BYTES = 8

/** Bit length of the Wesolowski challenge prime $\ell$ ($2\lambda$ for $\lambda = 128$). */
export const CHALLENGE_PRIME_BITS = 256

const encoder = new TextEncoder()
const TAG_BYTES = encoder.encode(DOMAIN_TAG)
const GROUP_CONTEXT = encoder.encode('group')
const CHALLENGE_CONTEXT = encoder.encode('challenge')
const PRIME_CONTEXT = encoder.encode('prime')
const MODULUS_CONTEXT = encoder.encode('modulus')

/**
 * Transcript encoding used for every hash in the package:
 *
 * $$\mathrm{transcript} = LP(\texttt{'mindpeeker-vdf-v2'}) \,\|\, LP(\mathrm{context})
 *   \,\|\, LP(\mathrm{BE}_w(n)) \,\|\, LP(f_1) \,\|\, \dots \,\|\, LP(f_k)$$
 *
 * where `LP(f)` is a 4-byte big-endian length followed by the field bytes and
 * $\mathrm{BE}_w(n)$ is the modulus at its own byte width
 * $w = \lceil \mathrm{bitLength}(n)/8 \rceil$. Length prefixes make the encoding
 * injective; the context string separates the group map, Fiat–Shamir challenges,
 * challenge primes, and fingerprints; binding $n$ ties every hash to the statement
 * $(n, x, T, y)$ the proofs are actually about.
 */
function transcript(context: Uint8Array, n: bigint, fields: readonly Uint8Array[]): Uint8Array {
  const parts = [TAG_BYTES, context, bigIntToBytes(n, byteLength(n)), ...fields]
  let total = 0
  for (const part of parts) total += 4 + part.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(u32be(part.length), offset)
    out.set(part, offset + 4)
    offset += 4 + part.length
  }
  return out
}

/**
 * Map arbitrary bytes to a canonical signed quadratic residue:
 * $x = |H'(\mathrm{input})^2 \bmod n| \in QR_n^+$.
 *
 * $H'$ is counter-mode SHA-256 expansion to the modulus width $w$ bytes, reduced
 * mod $n$:
 *
 * $$H'(m) = \mathrm{BE}\Big(\big\|_{i=0}^{\lceil w/32 \rceil - 1}
 *   \mathrm{SHA256}\big(LP(\mathrm{tag}) \| LP(\texttt{'group'}) \| LP(n) \| LP(m)
 *   \| LP(\mathrm{u32be}(i))\big)\Big)[0..w) \bmod n$$
 *
 * Squaring lands in $QR_n$ and canonicalisation in $QR_n^+$, where $-1$ is the
 * identity: an element and its negation are the same group element, so neither
 * the output nor a midpoint can be "sign-flipped" (Pietrzak, ITCS 2019, works in
 * $QR_N^+$ for exactly this reason). For $n$ a product of two safe primes $QR_n^+$
 * has odd order $p'q'$ and no low-order elements.
 *
 * The expansion is truncated to exactly $w$ bytes before `% n`, so the map is not
 * statistically uniform (residues below $2^{8w} \bmod n$ are up to 2× likelier).
 * This is harmless: $x$ is public and sequentiality/soundness need only
 * $x \in QR_n^+$, not uniformity.
 */
export async function hashToGroup(
  input: Uint8Array | ArrayLike<number>,
  modulus: RsaModulus,
): Promise<bigint> {
  const n = assertModulus(modulus)
  return hashToGroupSync(toBytes(input, 'input'), n)
}

/** Synchronous core of {@link hashToGroup} for already-validated inputs. */
export function hashToGroupSync(bytes: Uint8Array, n: bigint): bigint {
  const width = byteLength(n)
  const blockCount = Math.ceil(width / 32)
  const expanded = new Uint8Array(blockCount * 32)
  for (let i = 0; i < blockCount; i++) {
    expanded.set(sha256(transcript(GROUP_CONTEXT, n, [bytes, u32be(i)])), i * 32)
  }
  const h = bytesToBigInt(expanded.subarray(0, width)) % n
  return canon((h * h) % n, n)
}

/**
 * Fiat–Shamir challenge for one halving round, binding the modulus and the whole
 * round state:
 *
 * $$r_i = \mathrm{BE}\Big(\mathrm{SHA256}\big(LP(\mathrm{tag}) \|
 *   LP(\texttt{'challenge'}) \| LP(n) \| LP(x_i) \| LP(y_i) \| LP(\mu_i) \|
 *   LP(\mathrm{u32be}(T_i))\big)[0..16)\Big) \in [0, 2^{128})$$
 *
 * $x_i, y_i, \mu_i$ are fixed-width big-endian at the modulus byte length (the
 * honest values are canonical); $y_i$ is the value at round *start* (before the
 * odd-$T$ squaring). Pietrzak's analysis bounds a cheating prover's survival per
 * round by $\approx 3/2^{128}$ for 128-bit challenges in a group without low-order
 * elements such as $QR_N^+$; over $\le 32$ rounds the union bound stays below
 * $2^{-121}$.
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
  return challengeSync(x, y, mu, T, n)
}

/** Synchronous core of {@link fiatShamirChallenge} for already-validated inputs. */
export function challengeSync(x: bigint, y: bigint, mu: bigint, T: number, n: bigint): bigint {
  const width = byteLength(n)
  const digest = sha256(
    transcript(CHALLENGE_CONTEXT, n, [
      bigIntToBytes(x, width),
      bigIntToBytes(y, width),
      bigIntToBytes(mu, width),
      u32be(T),
    ]),
  )
  return bytesToBigInt(digest.subarray(0, 16))
}

/**
 * Wesolowski challenge prime $\ell = \mathrm{HashToPrime}(n, x, y, T)$, a
 * {@link CHALLENGE_PRIME_BITS}-bit prime. Candidate $j = 0, 1, 2, \dots$ is
 *
 * $$c_j = \mathrm{BE}\big(\mathrm{SHA256}(LP(\mathrm{tag}) \| LP(\texttt{'prime'}) \|
 *   LP(n) \| LP(x) \| LP(y) \| LP(\mathrm{u32be}(T)) \| LP(\mathrm{u32be}(j)))\big)
 *   \;\mathrm{OR}\; (2^{255} + 1)$$
 *
 * (top bit forced so $\ell$ has exactly 256 bits, low bit forced odd), and $\ell$
 * is the first candidate that passes the deterministic test `isProbablePrime`:
 * trial division by the primes below 2000, then strong Miller–Rabin to the 32
 * fixed bases $2, 3, \dots, 131$. Boneh–Bünz–Fisch (*A Survey of Two Verifiable
 * Delay Functions*, eprint 2018/712, §3) take $\ell$ from $\mathrm{Primes}(2\lambda)$;
 * 256 bits exceeds the 128-bit minimum with margin. About $\ln(2^{256})/2 \approx 89$
 * candidates are hashed on average.
 */
export async function hashToPrime(
  x: bigint,
  y: bigint,
  T: number,
  modulus: RsaModulus,
): Promise<bigint> {
  const n = assertModulus(modulus)
  assertT(T)
  return hashToPrimeSync(x, y, T, n)
}

/** Synchronous core of {@link hashToPrime} for already-validated inputs. */
export function hashToPrimeSync(x: bigint, y: bigint, T: number, n: bigint): bigint {
  const width = byteLength(n)
  const fields = [bigIntToBytes(x, width), bigIntToBytes(y, width), u32be(T)]
  const forced = (1n << BigInt(CHALLENGE_PRIME_BITS - 1)) | 1n
  for (let j = 0; j <= 0xffff_ffff; j++) {
    const digest = sha256(transcript(PRIME_CONTEXT, n, [...fields, u32be(j)]))
    const candidate = bytesToBigInt(digest) | forced
    if (isProbablePrime(candidate)) return candidate
  }
  throw new VdfError('invalid_input', 'hashToPrime exhausted its 2^32 candidates')
}

/**
 * 8-byte modulus fingerprint carried by every wire format:
 * $\mathrm{SHA256}(LP(\mathrm{tag}) \| LP(\texttt{'modulus'}) \| LP(n))[0..8)$.
 * Parsers compare it with the fingerprint of the modulus they were given and
 * throw `VdfError('modulus_mismatch')` on a difference — so a proof made under one
 * modulus is never silently decoded under another of the same width.
 */
export function modulusFingerprint(modulus: RsaModulus): Uint8Array {
  const n = assertModulus(modulus)
  return fingerprintSync(n)
}

/** Synchronous core of {@link modulusFingerprint} for an already-validated modulus. */
export function fingerprintSync(n: bigint): Uint8Array {
  return sha256(transcript(MODULUS_CONTEXT, n, [])).slice(0, FINGERPRINT_BYTES)
}
