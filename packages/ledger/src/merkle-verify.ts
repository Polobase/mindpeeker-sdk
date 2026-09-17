import { LedgerError } from './errors.js'
import { bytesEqual, requireSafeInteger } from './internal/bytes.js'
import { HASH_BYTES, leafHash, nodeHash } from './merkle.js'
import type { BytesInput } from './types.js'

function requireByteArray(value: unknown, what: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new LedgerError('invalid_input', `${what} must be a Uint8Array`)
  }
  return value
}

function requireProof(proof: unknown): readonly Uint8Array[] {
  if (!Array.isArray(proof)) {
    throw new LedgerError('invalid_input', 'proof must be an array of Uint8Array')
  }
  for (const [i, node] of proof.entries()) requireByteArray(node, `proof[${i}]`)
  return proof as readonly Uint8Array[]
}

const isHash = (bytes: Uint8Array): boolean => bytes.length === HASH_BYTES
const half = (x: number): number => Math.floor(x / 2)
const odd = (x: number): boolean => x % 2 === 1

/** Power-of-two test valid for every safe integer (bitwise operators are 32-bit). */
function isPowerOfTwo(x: number): boolean {
  let rest = x
  while (rest > 1 && rest % 2 === 0) rest /= 2
  return rest === 1
}

/**
 * Verify an RFC 6962 inclusion proof for a leaf **hash** (RFC 9162 §2.1.3.2):
 * true iff `leafHashBytes` sits at `index` of the tree of `size` leaves whose
 * root is `root`. Use this when a log hands out leaf hashes; for raw leaf data
 * use {@link verifyInclusion}.
 *
 * Returns false (never throws) for proofs that do not verify, including
 * `index ≥ size`, a proof of the wrong length and hashes that are not 32
 * bytes.
 *
 * @throws {LedgerError} `invalid_input` when `index`/`size` are not safe
 *   integers ≥ 0 or an argument is not a `Uint8Array` (array).
 */
export async function verifyInclusionHash(
  leafHashBytes: Uint8Array,
  index: number,
  size: number,
  proof: readonly Uint8Array[],
  root: Uint8Array,
): Promise<boolean> {
  requireByteArray(leafHashBytes, 'leafHash')
  requireSafeInteger(index, 'index')
  requireSafeInteger(size, 'size')
  const nodes = requireProof(proof)
  requireByteArray(root, 'root')
  if (index >= size || !isHash(leafHashBytes) || !isHash(root) || !nodes.every(isHash)) {
    return false
  }
  let fn = index
  let sn = size - 1
  let r = leafHashBytes
  for (const p of nodes) {
    if (sn === 0) return false
    if (odd(fn) || fn === sn) {
      r = await nodeHash(p, r)
      while (!odd(fn) && fn !== 0) {
        fn = half(fn)
        sn = half(sn)
      }
    } else {
      r = await nodeHash(r, p)
    }
    fn = half(fn)
    sn = half(sn)
  }
  return sn === 0 && bytesEqual(r, root)
}

/**
 * Verify that `leaf` (raw data; a string is its UTF-8 bytes) is the entry at
 * `index` of the RFC 6962 tree of `size` leaves with root `root`, given the
 * audit path from `inclusionProof`. See {@link verifyInclusionHash}.
 */
export async function verifyInclusion(
  leaf: BytesInput,
  index: number,
  size: number,
  proof: readonly Uint8Array[],
  root: Uint8Array,
): Promise<boolean> {
  return verifyInclusionHash(await leafHash(leaf), index, size, proof, root)
}

/**
 * Verify an RFC 6962 consistency proof (RFC 9162 §2.1.4.2): true iff the tree
 * of `m` leaves with root `rootM` is a prefix of the tree of `n` leaves with
 * root `rootN` — nothing logged before was changed or removed.
 *
 * Edge cases follow transparency-dev/merkle: `m > n` and `m = 0` are false (a
 * proof from the empty tree is meaningless); `m = n` is true iff the proof is
 * empty and the roots are byte-equal.
 *
 * @throws {LedgerError} `invalid_input` when `m`/`n` are not safe integers ≥ 0
 *   or an argument is not a `Uint8Array` (array).
 */
export async function verifyConsistency(
  m: number,
  n: number,
  rootM: Uint8Array,
  rootN: Uint8Array,
  proof: readonly Uint8Array[],
): Promise<boolean> {
  requireSafeInteger(m, 'm')
  requireSafeInteger(n, 'n')
  requireByteArray(rootM, 'rootM')
  requireByteArray(rootN, 'rootN')
  const nodes = requireProof(proof)
  if (m > n || m === 0) return false
  if (m === n) return nodes.length === 0 && bytesEqual(rootM, rootN)
  if (nodes.length === 0 || !isHash(rootM) || !isHash(rootN) || !nodes.every(isHash)) {
    return false
  }
  // Step 2: a power-of-two first tree is itself a node of the second tree.
  const path = isPowerOfTwo(m) ? [rootM, ...nodes] : [...nodes]
  let fn = m - 1
  let sn = n - 1
  while (odd(fn)) {
    fn = half(fn)
    sn = half(sn)
  }
  let fr = path[0] as Uint8Array
  let sr = fr
  for (const c of path.slice(1)) {
    if (sn === 0) return false
    if (odd(fn) || fn === sn) {
      fr = await nodeHash(c, fr)
      sr = await nodeHash(c, sr)
      while (!odd(fn) && fn !== 0) {
        fn = half(fn)
        sn = half(sn)
      }
    } else {
      sr = await nodeHash(sr, c)
    }
    fn = half(fn)
    sn = half(sn)
  }
  return sn === 0 && bytesEqual(fr, rootM) && bytesEqual(sr, rootN)
}
