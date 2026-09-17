import { describe, expect, test } from 'bun:test'
import { leafHash, merkleTree, nodeHash } from '../src/merkle.js'
import { verifyConsistency, verifyInclusion, verifyInclusionHash } from '../src/merkle-verify.js'
import { b64, fixture, flip } from './helpers/fixtures.js'

interface Probe {
  file: string
  desc: string
  wantErr: boolean
  leafIdx?: number
  treeSize?: number
  leafHash?: string
  root?: string
  size1?: number
  size2?: number
  root1?: string
  root2?: string
  proof: string[] | null
}
const { probes } = fixture<{ probes: Probe[] }>('merkle-probes.json')

/**
 * Outcome of one probe: true (verified), false, or 'rejected' when the
 * arguments are outside what the API accepts (uint64 indices above 2^53).
 */
async function run(probe: Probe): Promise<boolean | 'rejected'> {
  const proof = (probe.proof ?? []).map(b64)
  try {
    if (probe.file.startsWith('testdata/inclusion/')) {
      return await verifyInclusionHash(
        b64(probe.leafHash ?? ''),
        probe.leafIdx as number,
        probe.treeSize as number,
        proof,
        b64(probe.root ?? ''),
      )
    }
    return await verifyConsistency(
      probe.size1 as number,
      probe.size2 as number,
      b64(probe.root1 ?? ''),
      b64(probe.root2 ?? ''),
      proof,
    )
  } catch (error) {
    expect(error).toMatchObject({ code: 'invalid_input' })
    return 'rejected'
  }
}

describe('transparency-dev/merkle verification probes (Apache-2.0)', () => {
  test('the probe set is complete', () => {
    expect(probes.length).toBe(196)
    expect(probes.filter((p) => !p.wantErr).length).toBeGreaterThan(10)
  })

  test.each(probes.map((p) => [p.file, p] as const))('%s', async (_file, probe) => {
    const outcome = await run(probe)
    if (probe.wantErr) {
      expect(outcome === false || outcome === 'rejected').toBe(true)
      if (outcome === 'rejected') expect(probe.leafIdx).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
    } else {
      expect(outcome).toBe(true)
    }
  })
})

describe('tamper resistance of our own proofs', () => {
  const leaves = Array.from({ length: 13 }, (_, i) => `line ${i}`)

  test('altering an inclusion proof, the leaf, index, size or root fails', async () => {
    const tree = await merkleTree(leaves)
    for (const index of [0, 5, 12]) {
      const proof = tree.inclusionProof(index)
      expect(await verifyInclusion(leaves[index] as string, index, 13, proof, tree.root)).toBe(true)
      for (let j = 0; j < proof.length; j++) {
        const bad = proof.map((x) => x.slice())
        flip(bad[j] as Uint8Array, 31)
        expect(await verifyInclusion(leaves[index] as string, index, 13, bad, tree.root)).toBe(
          false,
        )
      }
      expect(await verifyInclusion(`${leaves[index]}!`, index, 13, proof, tree.root)).toBe(false)
      expect(await verifyInclusion(leaves[index] as string, index ^ 1, 13, proof, tree.root)).toBe(
        false,
      )
      // A size with a different path shape fails. (Sizes with the same shape for this index,
      // e.g. 13 and 14 for index 0, are not distinguished by the path alone: the size is
      // authenticated by the signed checkpoint that carries it together with the root.)
      expect(await verifyInclusion(leaves[index] as string, index, 20, proof, tree.root)).toBe(
        false,
      )
      expect(
        await verifyInclusion(leaves[index] as string, index, 13, proof.slice(1), tree.root),
      ).toBe(false)
      const root = tree.root.slice()
      flip(root, 0)
      expect(await verifyInclusion(leaves[index] as string, index, 13, proof, root)).toBe(false)
    }
  })

  test('consistency fails against a rewritten history', async () => {
    const before = await merkleTree(leaves.slice(0, 7))
    const after = await merkleTree(leaves)
    const proof = after.consistencyProof(7)
    expect(await verifyConsistency(7, 13, before.root, after.root, proof)).toBe(true)
    const forked = await merkleTree([...leaves.slice(0, 3), 'rewritten', ...leaves.slice(4)])
    expect(await verifyConsistency(7, 13, before.root, forked.root, proof)).toBe(false)
    expect(
      await verifyConsistency(7, 13, before.root, forked.root, forked.consistencyProof(7)),
    ).toBe(false)
    expect(await verifyConsistency(8, 13, before.root, after.root, proof)).toBe(false)
  })

  test('sizes beyond 32 bits: PROOF(2^40, D[2^40 + 1]) = [MTH of the new leaf]', async () => {
    // For m a power of two and n = m + 1 the RFC recursion gives the one-node proof
    // [leafHash(d_m)] and MTH(D_n) = H(0x01 || MTH(D_m) || leafHash(d_m)). Verifying it
    // needs the power-of-two prepend step and shift arithmetic past 2^31.
    const rootM = await leafHash('stand-in for a 2^40-leaf root')
    const newLeaf = await leafHash('leaf 2^40')
    const rootN = await nodeHash(rootM, newLeaf)
    expect(await verifyConsistency(2 ** 40, 2 ** 40 + 1, rootM, rootN, [newLeaf])).toBe(true)
    const forged = rootN.slice()
    flip(forged, 5)
    expect(await verifyConsistency(2 ** 40, 2 ** 40 + 1, rootM, forged, [newLeaf])).toBe(false)
    expect(await verifyConsistency(2 ** 40 - 1, 2 ** 40 + 1, rootM, rootN, [newLeaf])).toBe(false)
    const index = 2 ** 40
    expect(await verifyInclusionHash(newLeaf, index, index + 1, [rootM], rootN)).toBe(true)
    expect(await verifyInclusionHash(newLeaf, index - 1, index + 1, [rootM], rootN)).toBe(false)
  })
})

describe('argument validation', () => {
  const invalid = { code: 'invalid_input' }
  const h = new Uint8Array(32)
  test('non-integer sizes and non-byte arguments throw', async () => {
    await expect(verifyInclusionHash(h, 1.5, 4, [], h)).rejects.toMatchObject(invalid)
    await expect(verifyInclusionHash(h, 0, -1, [], h)).rejects.toMatchObject(invalid)
    await expect(verifyInclusionHash('x' as never, 0, 1, [], h)).rejects.toMatchObject(invalid)
    await expect(verifyInclusionHash(h, 0, 1, [1] as never, h)).rejects.toMatchObject(invalid)
    await expect(verifyInclusionHash(h, 0, 1, null as never, h)).rejects.toMatchObject(invalid)
    await expect(verifyConsistency(1, 2 ** 53, h, h, [h])).rejects.toMatchObject(invalid)
    await expect(verifyConsistency(1, 2, h, 'x' as never, [h])).rejects.toMatchObject(invalid)
  })

  test('semantic problems return false', async () => {
    expect(await verifyInclusionHash(h, 4, 4, [], h)).toBe(false)
    expect(await verifyInclusionHash(new Uint8Array(31), 0, 1, [], h)).toBe(false)
    expect(await verifyConsistency(0, 3, h, h, [h])).toBe(false)
    expect(await verifyConsistency(3, 2, h, h, [h])).toBe(false)
    expect(await verifyConsistency(2, 2, h, h, [h])).toBe(false)
    expect(await verifyConsistency(2, 2, h, h, [])).toBe(true)
  })
})
