import { describe, expect, test } from 'bun:test'
import { toHex } from '../src/hash.js'
import {
  consistencyProof,
  inclusionProof,
  leafHash,
  merkleRoot,
  merkleTree,
  nodeHash,
} from '../src/merkle.js'
import { verifyConsistency, verifyInclusion } from '../src/merkle-verify.js'
import { fixture, flip, hex } from './helpers/fixtures.js'

interface MerkleFixture {
  leaves: string[]
  roots: string[]
  inclusion: { size: number; index: number; proof: string[] }[]
  consistency: { m: number; n: number; proof: string[] }[]
  digests: { size: number; inclusion: string; consistency: string }[]
}
const fx = fixture<MerkleFixture>('merkle-rfc6962.json')
const leaves = fx.leaves.map(hex)

/** u32be(count) ‖ nodes, concatenated over proofs, then SHA-256 — the generator's digest encoding. */
async function proofDigest(proofs: Uint8Array[][]): Promise<string> {
  const parts: number[] = []
  for (const proof of proofs) {
    parts.push(
      (proof.length >>> 24) & 255,
      (proof.length >>> 16) & 255,
      (proof.length >>> 8) & 255,
      proof.length & 255,
    )
    for (const node of proof) parts.push(...node)
  }
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(parts))))
}

describe('RFC 6962 hashing', () => {
  test('transparency-dev/certificate-transparency reference roots for sizes 0..8', async () => {
    // RootHashes() in github.com/transparency-dev/merkle testonly/constants.go
    const reference = [
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      '6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d',
      'fac54203e7cc696cf0dfcb42c92a1d9dbaf70ad9e621f4bd8d98662f00e3c125',
      'aeb6bcfe274b70a14fb067a5e5578264db0fa9b51af5e0ba159158f329e06e77',
      'd37ee418976dd95753c1c73862b9398fa2a2cf9b4ff0fdfe8b30cd95209614b7',
      '4e3bbb1f7b478dcfe71fb631631519a3bca12c9aefca1612bfce4c13a86264d4',
      '76e67dadbcdf1e10e1b74ddc608abd2f98dfb16fbce75277b5232a127f2087ef',
      'ddb89be403809e325750d3d263cd78929c2942b7942a34b77e122c9594a74c8c',
      '5dc9da79a70659a9ad559cb701ded9a2ab9d823aad2f4960cfe370eff4604328',
    ]
    for (let n = 0; n <= 8; n++) {
      expect(toHex(await merkleRoot(leaves.slice(0, n)))).toBe(reference[n] as string)
    }
  })

  test('roots for every size 0..64 match the independent Python recursion', async () => {
    for (let n = 0; n <= 64; n++) {
      expect(toHex(await merkleRoot(leaves.slice(0, n))), `size ${n}`).toBe(fx.roots[n] as string)
    }
  })

  test('leaf and node hashes use the 0x00/0x01 domain prefixes', async () => {
    const leaf = await leafHash(new Uint8Array([1, 2]))
    const direct = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([0, 1, 2])))
    expect(leaf).toEqual(direct)
    const node = await nodeHash(leaf, leaf)
    const joined = new Uint8Array(65)
    joined[0] = 1
    joined.set(leaf, 1)
    joined.set(leaf, 33)
    expect(node).toEqual(new Uint8Array(await crypto.subtle.digest('SHA-256', joined)))
    // a leaf equal to two concatenated hashes does not collide with the node
    const concat = new Uint8Array(64)
    concat.set(leaf)
    concat.set(leaf, 32)
    expect(await leafHash(concat)).not.toEqual(node)
  })

  test('string leaves hash as UTF-8', async () => {
    const line = `{"note":"${String.fromCodePoint(0x2014)}"}`
    expect(await merkleRoot([line, 'b'])).toEqual(
      await merkleRoot([new TextEncoder().encode(line), new Uint8Array([98])]),
    )
  })
})

describe('proof generation against the Python RFC 6962 recursions', () => {
  test('every inclusion proof for sizes 1..16', async () => {
    for (const { size, index, proof } of fx.inclusion) {
      const ours = await inclusionProof(leaves.slice(0, size), index)
      expect(ours.map(toHex), `PATH(${index}, D[${size}])`).toEqual(proof)
    }
  })

  test('every consistency proof for sizes 1..16', async () => {
    for (const { m, n, proof } of fx.consistency) {
      const ours = await consistencyProof(leaves.slice(0, n), m)
      expect(ours.map(toHex), `PROOF(${m}, D[${n}])`).toEqual(proof)
    }
  })

  test('digests over all proofs for sizes 17..64', async () => {
    for (const { size, inclusion, consistency } of fx.digests) {
      const tree = await merkleTree(leaves.slice(0, size))
      const incl: Uint8Array[][] = []
      const cons: Uint8Array[][] = []
      for (let i = 0; i < size; i++) incl.push(tree.inclusionProof(i))
      for (let m = 1; m <= size; m++) cons.push(tree.consistencyProof(m))
      expect(await proofDigest(incl), `inclusion, size ${size}`).toBe(inclusion)
      expect(await proofDigest(cons), `consistency, size ${size}`).toBe(consistency)
    }
  }, 30_000)

  test('every generated proof verifies (sizes 1..64)', async () => {
    for (let n = 1; n <= 64; n++) {
      const tree = await merkleTree(leaves.slice(0, n))
      const root = hex(fx.roots[n] as string)
      expect(tree.root).toEqual(root)
      for (let i = 0; i < n; i++) {
        const proof = tree.inclusionProof(i)
        expect(await verifyInclusion(leaves[i] as Uint8Array, i, n, proof, root)).toBe(true)
      }
      for (let m = 1; m <= n; m++) {
        const proof = tree.consistencyProof(m)
        expect(await verifyConsistency(m, n, hex(fx.roots[m] as string), root, proof)).toBe(true)
      }
    }
  }, 30_000)
})

describe('RFC 9162 §2.1.5 example tree (7 leaves)', () => {
  test('audit paths [b,h,l], [c,g,l], [f,j,k], [i,k] and PROOF(3, D[7]) = [c,d,g,l]', async () => {
    const d = leaves.slice(0, 7)
    const [a, b, c, dd, e, f, j] = await Promise.all(d.map((x) => leafHash(x)))
    const g = await nodeHash(a as Uint8Array, b as Uint8Array)
    const h = await nodeHash(c as Uint8Array, dd as Uint8Array)
    const i = await nodeHash(e as Uint8Array, f as Uint8Array)
    const k = await nodeHash(g, h)
    const l = await nodeHash(i, j as Uint8Array)
    expect(await inclusionProof(d, 0)).toEqual([b, h, l] as Uint8Array[])
    expect(await inclusionProof(d, 3)).toEqual([c, g, l] as Uint8Array[])
    expect(await inclusionProof(d, 4)).toEqual([f, j, k] as Uint8Array[])
    expect(await inclusionProof(d, 6)).toEqual([i, k])
    expect(await consistencyProof(d, 3)).toEqual([c, dd, g, l] as Uint8Array[])
    expect(await merkleRoot(d)).toEqual(await nodeHash(k, l))
  })
})

describe('argument validation', () => {
  const invalid = { code: 'invalid_input' }
  test('proof builders reject out-of-range indices and non-arrays', async () => {
    await expect(inclusionProof(leaves.slice(0, 3), 3)).rejects.toMatchObject(invalid)
    await expect(inclusionProof([], 0)).rejects.toMatchObject(invalid)
    await expect(inclusionProof(leaves, -1)).rejects.toMatchObject(invalid)
    await expect(consistencyProof(leaves.slice(0, 3), 0)).rejects.toMatchObject(invalid)
    await expect(consistencyProof(leaves.slice(0, 3), 4)).rejects.toMatchObject(invalid)
    await expect(merkleRoot('abc' as never)).rejects.toMatchObject(invalid)
    await expect(merkleRoot([42] as never)).rejects.toMatchObject(invalid)
  })

  test('nodeHash demands 32-byte children', async () => {
    await expect(nodeHash(new Uint8Array(31), new Uint8Array(32))).rejects.toMatchObject(invalid)
  })

  test('merkleTree hands out copies and validates indices', async () => {
    const tree = await merkleTree(leaves.slice(0, 5))
    const proof = tree.inclusionProof(1)
    flip(proof[0] as Uint8Array, 0, 0xff)
    expect(tree.inclusionProof(1)).not.toEqual(proof)
    expect(tree.leafHash(4)).toEqual(await leafHash(leaves[4] as Uint8Array))
    expect(() => tree.leafHash(5)).toThrow(expect.objectContaining(invalid))
    expect(() => tree.inclusionProof(1.5)).toThrow(expect.objectContaining(invalid))
    expect(() => tree.consistencyProof(6)).toThrow(expect.objectContaining(invalid))
    const empty = await merkleTree([])
    expect(empty.size).toBe(0)
    expect(toHex(empty.root)).toBe(fx.roots[0] as string)
  })

  test('consistency proof for m = n is empty', async () => {
    expect(await consistencyProof(leaves.slice(0, 5), 5)).toEqual([])
  })
})
