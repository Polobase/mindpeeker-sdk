import { describe, expect, test } from 'bun:test'
import { evaluate } from '../src/evaluate.js'
import { readU32be } from '../src/internal/bigint.js'
import { pietrzakProve } from '../src/prove.js'
import { PROOF_VERSION, proofFromBytes, proofToBytes } from '../src/serialize.js'
import type { PietrzakProof } from '../src/types.js'
import { pietrzakVerify } from '../src/verify.js'
import { expectVdfThrow } from './helpers/expect.js'
import { TEST_MODULUS } from './helpers/test-modulus.js'

const pulse = new TextEncoder().encode('pulse-1')
const opts = { modulus: TEST_MODULUS }
const WIDTH = 32 // 256-bit test modulus

const T = 1000
const { y } = await evaluate(pulse, T, opts)
const proof = await pietrzakProve(pulse, T, y, opts)
const bytes = proofToBytes(proof, opts)

describe('proofToBytes', () => {
  test('layout: version byte, u32 T, then fixed-width y and midpoints', () => {
    expect(bytes[0]).toBe(PROOF_VERSION)
    expect(readU32be(bytes, 1)).toBe(T)
    expect(bytes).toHaveLength(5 + WIDTH * (1 + proof.mus.length))
  })

  test('T=1 serializes to just version + T + y', async () => {
    const one = await evaluate(pulse, 1, opts)
    const p = await pietrzakProve(pulse, 1, one.y, opts)
    expect(proofToBytes(p, opts)).toHaveLength(5 + WIDTH)
  })

  test('rejects inconsistent or out-of-range proofs', () => {
    expectVdfThrow(() => proofToBytes({ T, y, mus: proof.mus.slice(1) }, opts), 'invalid_input')
    expectVdfThrow(
      () => proofToBytes({ T, y: TEST_MODULUS.n, mus: proof.mus }, opts),
      'invalid_input',
    )
    expectVdfThrow(() => proofToBytes({ T, y: -1n, mus: proof.mus }, opts), 'invalid_input')
    expectVdfThrow(
      () => proofToBytes({ T: 0, y, mus: [] } as unknown as PietrzakProof, opts),
      'invalid_input',
    )
  })
})

describe('proofFromBytes', () => {
  test('round-trips exactly', () => {
    const parsed = proofFromBytes(bytes, opts)
    expect(parsed.T).toBe(proof.T)
    expect(parsed.y).toBe(proof.y)
    expect(parsed.mus).toEqual(proof.mus as bigint[])
    expect(Object.isFrozen(parsed)).toBe(true)
  })

  test('a parsed proof verifies', async () => {
    const parsed = proofFromBytes(bytes, opts)
    expect(await pietrzakVerify(pulse, T, y, parsed, opts)).toBe(true)
  })

  test('rejects a wrong version byte', () => {
    const bad = Uint8Array.from(bytes)
    bad[0] = 0x02
    expectVdfThrow(() => proofFromBytes(bad, opts), 'invalid_input')
  })

  test('rejects wrong lengths: truncated, extended, and sub-header', () => {
    expectVdfThrow(() => proofFromBytes(bytes.subarray(0, bytes.length - 1), opts), 'invalid_input')
    const extended = new Uint8Array(bytes.length + 1)
    extended.set(bytes, 0)
    expectVdfThrow(() => proofFromBytes(extended, opts), 'invalid_input')
    expectVdfThrow(
      () => proofFromBytes(new Uint8Array([PROOF_VERSION, 0, 0]), opts),
      'invalid_input',
    )
  })

  test('rejects a header T of zero', () => {
    const bad = Uint8Array.from(bytes)
    bad[1] = 0
    bad[2] = 0
    bad[3] = 0
    bad[4] = 0
    expectVdfThrow(() => proofFromBytes(bad, opts), 'invalid_input')
  })

  test('rejects a header T that disagrees with the byte count', () => {
    const bad = Uint8Array.from(bytes)
    // T=4 needs 2 midpoints, not the 10 present — the exact-length check fires.
    bad[1] = 0
    bad[2] = 0
    bad[3] = 0
    bad[4] = 4
    expectVdfThrow(() => proofFromBytes(bad, opts), 'invalid_input')
  })

  test('a bit flip inside an element still parses but verifies false', async () => {
    const tampered = Uint8Array.from(bytes)
    tampered[5 + WIDTH - 1] = (tampered[5 + WIDTH - 1] as number) ^ 0x01 // low byte of y
    const parsed = proofFromBytes(tampered, opts)
    expect(await pietrzakVerify(pulse, T, parsed.y, parsed, opts)).toBe(false)
  })
})
