// RFC 6962 tree material for the ledger page. The package's `merkleTree` keeps
// its levels private (it only hands out roots and proofs), so the diagram
// rebuilds them here with the package's own exported `leafHash` / `nodeHash` —
// the same two functions, no re-implementation of the hashing.
//
// CLIENT-ONLY — imports @mindpeeker/ledger.

import { leafHash, nodeHash, toHex } from '@mindpeeker/ledger'

/** A node of the drawn tree: level 0 is the leaves, the last level the root. */
export interface TreeNode {
  readonly level: number
  readonly index: number
  readonly hex: string
  /** Leaf range [start, end) this node covers. */
  readonly start: number
  readonly end: number
}

export interface TreeLayout {
  readonly size: number
  readonly levels: readonly (readonly TreeNode[])[]
  readonly rootHex: string
}

/** Node reference used to highlight a proof path. */
export interface NodeRef {
  readonly level: number
  readonly index: number
}

const key = (ref: NodeRef): string => `${ref.level}:${ref.index}`

/** Membership test for a set of node references. */
export function refSet(refs: readonly NodeRef[]): Set<string> {
  return new Set(refs.map(key))
}

export function hasRef(set: Set<string>, level: number, index: number): boolean {
  return set.has(`${level}:${index}`)
}

/**
 * Build every level of the RFC 6962 tree exactly as `merkleTree` does: pair
 * nodes left to right, promote an unpaired last node unchanged. Level h index
 * j therefore covers leaves [j·2^h, min(n, (j+1)·2^h)).
 */
export async function treeLayout(leaves: readonly string[]): Promise<TreeLayout> {
  const n = leaves.length
  const hashes: Uint8Array[][] = [await Promise.all(leaves.map((leaf) => leafHash(leaf)))]
  for (let level = hashes[0] as Uint8Array[]; level.length > 1; ) {
    const below = level
    const next: Uint8Array[] = []
    for (let j = 0; j + 1 < below.length; j += 2) {
      next.push(await nodeHash(below[j] as Uint8Array, below[j + 1] as Uint8Array))
    }
    if (below.length % 2 === 1) next.push(below[below.length - 1] as Uint8Array)
    hashes.push(next)
    level = next
  }
  const levels = hashes.map((level, h) =>
    level.map((hash, index) => ({
      level: h,
      index,
      hex: toHex(hash),
      start: index * 2 ** h,
      end: Math.min(n, (index + 1) * 2 ** h),
    })),
  )
  return {
    size: n,
    levels,
    rootHex: (levels.at(-1)?.[0] as TreeNode | undefined)?.hex ?? '',
  }
}

/** Largest power of two strictly below n (n ≥ 2) — RFC 6962's split point k. */
function splitPoint(n: number): number {
  let k = 1
  while (k * 2 < n) k *= 2
  return k
}

/** The cached node covering leaves [start, end) in the layout above. */
function nodeRef(start: number, end: number): NodeRef {
  let level = 0
  while (2 ** level < end - start) level++
  return { level, index: start / 2 ** level }
}

/**
 * RFC 6962 §2.1.1 PATH(index, D_n) as node references, in the order
 * `inclusionProof(index)` returns the hashes — so the diagram can name which
 * sibling each proof hash is.
 */
export function inclusionRefs(index: number, size: number): NodeRef[] {
  const walk = (m: number, start: number, end: number): NodeRef[] => {
    if (end - start === 1) return []
    const k = splitPoint(end - start)
    return m < k
      ? [...walk(m, start, start + k), nodeRef(start + k, end)]
      : [...walk(m - k, start + k, end), nodeRef(start, start + k)]
  }
  return size === 0 || index >= size ? [] : walk(index, 0, size)
}

/** The nodes recomputed on the way from a leaf to the root (leaf and root included). */
export function climbRefs(index: number, size: number): NodeRef[] {
  const refs: NodeRef[] = []
  let levels = 1
  while (2 ** (levels - 1) < size) levels++
  for (let level = 0; level < levels; level++) refs.push({ level, index: Math.floor(index / 2 ** level) })
  return refs
}

/** Default log lines: short, readable, and obviously a log. */
export function defaultLeaves(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `session-log entry ${i}: sum=${1000 + ((i * 37) % 63)}`)
}
