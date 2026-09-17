import { LedgerError } from './errors.js'
import { concatBytes, requireSafeInteger, toBytes } from './internal/bytes.js'
import { digest256 } from './internal/subtle.js'
import type { BytesInput } from './types.js'

/** Byte length of every RFC 6962 (SHA-256) tree hash. */
export const HASH_BYTES = 32

const LEAF_PREFIX = new Uint8Array([0x00])
const NODE_PREFIX = new Uint8Array([0x01])
/** Hashes computed concurrently per batch (bounds pending WebCrypto promises). */
const BATCH = 4096

/**
 * RFC 6962 §2.1 leaf hash: $\mathrm{SHA\text{-}256}(\mathtt{0x00} \,\|\, d)$.
 * A string leaf is hashed as its UTF-8 bytes (e.g. one JSONL line).
 *
 * @throws {LedgerError} `invalid_input` for a leaf that is not a `Uint8Array`
 *   or a well-formed string.
 */
export async function leafHash(data: BytesInput): Promise<Uint8Array> {
  return digest256(concatBytes(LEAF_PREFIX, toBytes(data, 'leaf')))
}

function requireHash(value: unknown, what: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== HASH_BYTES) {
    throw new LedgerError('invalid_input', `${what} must be a ${HASH_BYTES}-byte Uint8Array`)
  }
  return value
}

/**
 * RFC 6962 §2.1 interior node hash:
 * $\mathrm{SHA\text{-}256}(\mathtt{0x01} \,\|\, L \,\|\, R)$. The distinct
 * prefixes separate leaves from nodes (second-preimage resistance).
 *
 * @throws {LedgerError} `invalid_input` unless both children are 32 bytes.
 */
export async function nodeHash(left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
  return digest256(concatBytes(NODE_PREFIX, requireHash(left, 'left'), requireHash(right, 'right')))
}

/** Run `task` over `count` indices, at most {@link BATCH} pending at once. */
async function batched(count: number, task: (i: number) => Promise<Uint8Array>) {
  const out: Uint8Array[] = []
  for (let start = 0; start < count; start += BATCH) {
    const jobs: Promise<Uint8Array>[] = []
    for (let i = start; i < Math.min(count, start + BATCH); i++) jobs.push(task(i))
    out.push(...(await Promise.all(jobs)))
  }
  return out
}

/** Largest power of two strictly below n (n ≥ 2). */
function splitPoint(n: number): number {
  let k = 1
  while (k * 2 < n) k *= 2
  return k
}

/**
 * An RFC 6962 Merkle tree with every level cached, so roots and proofs of a
 * fixed leaf list are computed once. Returned hashes are copies.
 */
export interface MerkleTree {
  /** Number of leaves. */
  readonly size: number
  /** MTH of all leaves (SHA-256 of the empty string for size 0). */
  readonly root: Uint8Array
  /** The leaf hash at `index`. */
  leafHash(index: number): Uint8Array
  /** Audit path PATH(index, D_n) — RFC 6962 §2.1.1. */
  inclusionProof(index: number): Uint8Array[]
  /** Consistency proof PROOF(m, D_n) — RFC 6962 §2.1.2; empty for m = n. */
  consistencyProof(m: number): Uint8Array[]
}

/**
 * Hash `leaves` into an RFC 6962 Merkle tree. Levels are built by pairing
 * nodes left to right and promoting an unpaired last node unchanged — exactly
 * the RFC recursion MTH(D_n) = H(0x01 ‖ MTH(D[0:k]) ‖ MTH(D[k:n])) with k the
 * largest power of two below n. Every subtree the RFC's proof recursions
 * visit is then one cached node: level h, index start/2^h.
 *
 * @throws {LedgerError} `invalid_input` for a non-array or a bad leaf.
 */
export async function merkleTree(leaves: readonly BytesInput[]): Promise<MerkleTree> {
  if (!Array.isArray(leaves)) {
    throw new LedgerError('invalid_input', 'leaves must be an array of Uint8Array or strings')
  }
  const n = leaves.length
  const levels: Uint8Array[][] = [await batched(n, (i) => leafHash(leaves[i] as BytesInput))]
  for (let level = levels[0] as Uint8Array[]; level.length > 1; ) {
    const below = level
    const next = await batched(Math.floor(below.length / 2), (j) =>
      nodeHash(below[2 * j] as Uint8Array, below[2 * j + 1] as Uint8Array),
    )
    if (below.length % 2 === 1) next.push(below[below.length - 1] as Uint8Array)
    levels.push(next)
    level = next
  }
  const root = n === 0 ? await digest256(new Uint8Array(0)) : (levels.at(-1)?.[0] as Uint8Array)

  /** MTH(D[start:end]) for a node range of this tree. */
  const node = (start: number, end: number): Uint8Array => {
    let h = 0
    while (2 ** h < end - start) h++
    return levels[h]?.[start / 2 ** h] as Uint8Array
  }
  const path = (m: number, start: number, end: number): Uint8Array[] => {
    if (end - start === 1) return []
    const k = splitPoint(end - start)
    return m < k
      ? [...path(m, start, start + k), node(start + k, end)]
      : [...path(m - k, start + k, end), node(start, start + k)]
  }
  const subproof = (m: number, start: number, end: number, complete: boolean): Uint8Array[] => {
    if (m === end - start) return complete ? [] : [node(start, end)]
    const k = splitPoint(end - start)
    return m <= k
      ? [...subproof(m, start, start + k, complete), node(start + k, end)]
      : [...subproof(m - k, start + k, end, false), node(start, start + k)]
  }
  const copy = (nodes: Uint8Array[]) => nodes.map((x) => x.slice())

  return Object.freeze({
    size: n,
    root: root.slice(),
    leafHash(index: number): Uint8Array {
      requireSafeInteger(index, 'index')
      if (index >= n) throw new LedgerError('invalid_input', `index ${index} ≥ tree size ${n}`)
      return (levels[0]?.[index] as Uint8Array).slice()
    },
    inclusionProof(index: number): Uint8Array[] {
      requireSafeInteger(index, 'index')
      if (index >= n) throw new LedgerError('invalid_input', `index ${index} ≥ tree size ${n}`)
      return copy(path(index, 0, n))
    },
    consistencyProof(m: number): Uint8Array[] {
      requireSafeInteger(m, 'm', 1)
      if (m > n) throw new LedgerError('invalid_input', `m ${m} exceeds the tree size ${n}`)
      return copy(subproof(m, 0, n, true))
    },
  })
}

/**
 * RFC 6962 Merkle Tree Hash of the leaves in order. The empty tree hashes to
 * SHA-256 of the empty string.
 *
 * @throws {LedgerError} `invalid_input` for a non-array or a leaf that is not
 *   a `Uint8Array`/well-formed string.
 */
export async function merkleRoot(leaves: readonly BytesInput[]): Promise<Uint8Array> {
  return (await merkleTree(leaves)).root
}

/**
 * RFC 6962 §2.1.1 audit path PATH(index, D_n): the sibling hashes from the
 * leaf up to the root, which `verifyInclusion` combines with the leaf. For
 * many proofs over the same leaves build a {@link merkleTree} once.
 *
 * @throws {LedgerError} `invalid_input` unless 0 ≤ index < leaves.length.
 */
export async function inclusionProof(
  leaves: readonly BytesInput[],
  index: number,
): Promise<Uint8Array[]> {
  requireSafeInteger(index, 'index')
  return (await merkleTree(leaves)).inclusionProof(index)
}

/**
 * RFC 6962 §2.1.2 consistency proof PROOF(m, D_n) that the tree of the first
 * `m` leaves is a prefix of the tree of all `n = leaves.length` leaves — the
 * append-only property. Empty for `m = n`.
 *
 * @throws {LedgerError} `invalid_input` unless 1 ≤ m ≤ leaves.length (a proof
 *   from the empty tree is meaningless).
 */
export async function consistencyProof(
  leaves: readonly BytesInput[],
  m: number,
): Promise<Uint8Array[]> {
  requireSafeInteger(m, 'm', 1)
  return (await merkleTree(leaves)).consistencyProof(m)
}
