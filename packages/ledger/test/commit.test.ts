import { describe, expect, test } from 'bun:test'
import { combineReveals, commit, MIN_NONCE_BYTES, openCommitment } from '../src/commit.js'
import { toHex } from '../src/hash.js'
import { fixture, hex } from './helpers/fixtures.js'

interface Kat {
  commits: { valueHex: string; nonceHex: string; commitment: string }[]
  combine: { valuesHex: string[]; xorHex: string; beaconHex: string; mixedHex: string }
}
const kat = fixture<Kat>('records-kat.json')
const invalid = { code: 'invalid_input' }

describe('commit (Python hashlib known answers)', () => {
  test.each(kat.commits.map((c, i) => [i, c] as const))('vector %i', async (_i, c) => {
    const commitment = await commit(hex(c.valueHex), hex(c.nonceHex))
    expect(toHex(commitment)).toBe(c.commitment)
    expect(await openCommitment(commitment, hex(c.valueHex), hex(c.nonceHex))).toBe(true)
  })

  test('string values commit to their UTF-8 bytes', async () => {
    const c = kat.commits[2] as Kat['commits'][0]
    expect(toHex(await commit('intention order: HLB', hex(c.nonceHex)))).toBe(c.commitment)
  })

  test('opening fails for any other value, nonce or commitment', async () => {
    const nonce = new Uint8Array(32).fill(9)
    const c = await commit('H', nonce)
    expect(await openCommitment(c, 'L', nonce)).toBe(false)
    expect(await openCommitment(c, 'H', new Uint8Array(32).fill(8))).toBe(false)
    expect(await openCommitment(c.slice(0, 31), 'H', nonce)).toBe(false)
    expect(await openCommitment(c, 'H', nonce.slice(0, MIN_NONCE_BYTES - 1))).toBe(false)
  })

  test('length prefixes keep (value, nonce) splits apart', async () => {
    const nonce = new Uint8Array(20).fill(1)
    // value "ab" + nonce vs value "a" + ("b" + nonce): same concatenated bytes, different commitments
    const shifted = new Uint8Array(21)
    shifted[0] = 0x62
    shifted.set(nonce, 1)
    expect(await commit('ab', nonce)).not.toEqual(await commit('a', shifted))
  })

  test('short nonces and wrong types are rejected', async () => {
    await expect(commit('x', new Uint8Array(MIN_NONCE_BYTES - 1))).rejects.toMatchObject(invalid)
    await expect(commit('x', 'nonce' as never)).rejects.toMatchObject(invalid)
    await expect(commit(7 as never, new Uint8Array(32))).rejects.toMatchObject(invalid)
    await expect(openCommitment('c' as never, 'x', new Uint8Array(32))).rejects.toMatchObject(
      invalid,
    )
  })
})

describe('combineReveals', () => {
  const values = kat.combine.valuesHex.map(hex)

  test('XOR of all reveals; beacon mixing matches the Python known answer', async () => {
    expect(toHex(await combineReveals(values))).toBe(kat.combine.xorHex)
    expect(toHex(await combineReveals(values, hex(kat.combine.beaconHex)))).toBe(
      kat.combine.mixedHex,
    )
  })

  test('XOR is order-independent and one uniform share masks the rest', async () => {
    const reversed = [...values].reverse()
    expect(await combineReveals(reversed)).toEqual(await combineReveals(values))
    // For fixed other shares, XOR is a bijection of the honest share: every output is reachable once.
    const others = [new Uint8Array([0x5a]), new Uint8Array([0xc3])]
    const outputs = new Set<number>()
    for (let v = 0; v < 256; v++) {
      outputs.add((await combineReveals([new Uint8Array([v]), ...others]))[0] as number)
    }
    expect(outputs.size).toBe(256)
  })

  test('rejects empty lists, unequal lengths and empty beacons', async () => {
    await expect(combineReveals([])).rejects.toMatchObject(invalid)
    await expect(combineReveals([new Uint8Array(0)])).rejects.toMatchObject(invalid)
    await expect(combineReveals([new Uint8Array(2), new Uint8Array(3)])).rejects.toMatchObject(
      invalid,
    )
    await expect(combineReveals(values, new Uint8Array(0))).rejects.toMatchObject(invalid)
    await expect(combineReveals(['ab'] as never)).rejects.toMatchObject(invalid)
  })

  test('inputs are copied: mutating a reveal afterwards changes nothing', async () => {
    const share = new Uint8Array([1, 2, 3])
    const result = await combineReveals([share])
    share[0] = 99
    expect(result).toEqual(new Uint8Array([1, 2, 3]))
  })
})
