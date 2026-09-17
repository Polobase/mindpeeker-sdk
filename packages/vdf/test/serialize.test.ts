import { describe, expect, test } from 'bun:test'
import { evaluate } from '../src/evaluate.js'
import { modulusFingerprint } from '../src/hash.js'
import { readU32be } from '../src/internal/bigint.js'
import { pietrzakProve } from '../src/prove.js'
import {
  PROOF_VERSION,
  proofFromBytes,
  proofToBytes,
  wesolowskiFromBytes,
  wesolowskiToBytes,
} from '../src/serialize.js'
import type { PietrzakProof, WesolowskiProof } from '../src/types.js'
import { pietrzakVerify } from '../src/verify.js'
import { wesolowskiVerify } from '../src/wesolowski.js'
import { expectVdfThrow } from './helpers/expect.js'
import { fromHex, loadFixture, toHex } from './helpers/fixture.js'
import { TEST_MODULUS } from './helpers/test-modulus.js'

const fixture = loadFixture()
const pulse = new TextEncoder().encode('pulse-1')
const opts = { modulus: TEST_MODULUS }
const WIDTH = 32 // 256-bit test modulus
const HEADER = 14

const T = 1000
const { y } = await evaluate(pulse, T, opts)
const proof = await pietrzakProve(pulse, T, y, opts)
const bytes = proofToBytes(proof, opts)

function fixtureProof(index: number): PietrzakProof {
  const c = fixture.proofs[index]
  if (!c) throw new Error(`fixture proof ${index} missing`)
  return { T: c.T, y: BigInt(c.y), mus: c.mus.map(BigInt) }
}

function fixtureWesolowski(index: number): WesolowskiProof {
  const c = fixture.wesolowski[index]
  if (!c) throw new Error(`fixture Wesolowski proof ${index} missing`)
  return { T: c.T, y: BigInt(c.y), pi: BigInt(c.pi) }
}

describe('proofToBytes', () => {
  test('layout: version 0x02, kind P, fingerprint, u32 T, fixed-width y and midpoints', () => {
    expect(PROOF_VERSION).toBe(0x02)
    expect(bytes[0]).toBe(0x02)
    expect(bytes[1]).toBe(0x50)
    expect(toHex(bytes.subarray(2, 10))).toBe(toHex(modulusFingerprint(TEST_MODULUS)))
    expect(readU32be(bytes, 10)).toBe(T)
    expect(bytes).toHaveLength(HEADER + WIDTH * (1 + proof.mus.length))
  })

  test('matches the Python encoding byte for byte (256-bit and 522-bit moduli)', () => {
    const { proofIndex, hex } = fixture.wire.pietrzak
    expect(toHex(proofToBytes(fixtureProof(proofIndex), opts))).toBe(hex)
    const odd = fixture.oddWidth
    const oddProof = { T: odd.proof.T, y: BigInt(odd.proof.y), mus: odd.proof.mus.map(BigInt) }
    expect(toHex(proofToBytes(oddProof, { modulus: { n: BigInt(odd.n) } }))).toBe(odd.proofHex)
  })

  test('T=1 serializes to just the header + y', async () => {
    const one = await evaluate(pulse, 1, opts)
    const p = await pietrzakProve(pulse, 1, one.y, opts)
    expect(proofToBytes(p, opts)).toHaveLength(HEADER + WIDTH)
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
  test('round-trips exactly, from Uint8Array and from a plain array', () => {
    for (const input of [bytes, Array.from(bytes)]) {
      const parsed = proofFromBytes(input, opts)
      expect(parsed.T).toBe(proof.T)
      expect(parsed.y).toBe(proof.y)
      expect(parsed.mus).toEqual(proof.mus as bigint[])
      expect(Object.isFrozen(parsed)).toBe(true)
    }
  })

  test('a parsed proof verifies; the Python bytes parse to the Python proof', async () => {
    expect(await pietrzakVerify(pulse, T, y, proofFromBytes(bytes, opts), opts)).toBe(true)
    const { proofIndex, hex } = fixture.wire.pietrzak
    expect(proofFromBytes(fromHex(hex), opts)).toEqual(fixtureProof(proofIndex))
  })

  test('0.1.0 proofs (version 0x01) are rejected with unsupported_version', () => {
    const legacy = new Uint8Array(5 + WIDTH * 11)
    legacy[0] = 0x01
    legacy[4] = 0x08 // any T
    expectVdfThrow(() => proofFromBytes(legacy, opts), 'unsupported_version')
    const future = Uint8Array.from(bytes)
    future[0] = 0x03
    expectVdfThrow(() => proofFromBytes(future, opts), 'unsupported_version')
  })

  test('a proof from another modulus is rejected with modulus_mismatch', () => {
    const same = { n: TEST_MODULUS.n + 2n } // same byte width
    expectVdfThrow(() => proofFromBytes(bytes, { modulus: same }), 'modulus_mismatch')
  })

  test('kind confusion: Wesolowski bytes are not a Pietrzak proof and vice versa', () => {
    const w = wesolowskiToBytes(fixtureWesolowski(0), opts)
    expectVdfThrow(() => proofFromBytes(w, opts), 'invalid_input')
    const oneRound = proofToBytes(fixtureProof(0), opts) // T=1, same length as nothing else
    expectVdfThrow(() => wesolowskiFromBytes(oneRound, opts), 'invalid_input')
  })

  test('declared length is checked before allocating (hostile ArrayLike)', () => {
    const started = performance.now()
    expectVdfThrow(() => proofFromBytes({ length: 2 ** 40 }, opts), 'invalid_input')
    expectVdfThrow(() => proofFromBytes({ length: 2 ** 31 }, opts), 'invalid_input')
    expectVdfThrow(() => proofFromBytes({ length: -1 }, opts), 'invalid_input')
    expectVdfThrow(() => proofFromBytes({ length: Number.NaN }, opts), 'invalid_input')
    expect(performance.now() - started).toBeLessThan(100)
  })

  test('rejects wrong lengths: truncated, extended, empty, and sub-header', () => {
    expectVdfThrow(() => proofFromBytes(bytes.subarray(0, bytes.length - 1), opts), 'invalid_input')
    const extended = new Uint8Array(bytes.length + 1)
    extended.set(bytes, 0)
    expectVdfThrow(() => proofFromBytes(extended, opts), 'invalid_input')
    expectVdfThrow(() => proofFromBytes(new Uint8Array(0), opts), 'invalid_input')
    expectVdfThrow(() => proofFromBytes(bytes.subarray(0, 12), opts), 'invalid_input')
  })

  test('rejects a header T of zero and a T that disagrees with the byte count', () => {
    const zero = Uint8Array.from(bytes)
    zero.fill(0, 10, 14)
    expectVdfThrow(() => proofFromBytes(zero, opts), 'invalid_input')
    const four = Uint8Array.from(bytes)
    four.set([0, 0, 0, 4], 10) // T=4 needs 2 midpoints, not the 10 present
    expectVdfThrow(() => proofFromBytes(four, opts), 'invalid_input')
  })

  test('a bit flip inside an element still parses but verifies false', async () => {
    const tampered = Uint8Array.from(bytes)
    tampered[HEADER + WIDTH - 1] = (tampered[HEADER + WIDTH - 1] as number) ^ 0x01 // low byte of y
    const parsed = proofFromBytes(tampered, opts)
    expect(await pietrzakVerify(pulse, T, parsed.y, parsed, opts)).toBe(false)
  })

  test('zero elements serialize, parse, and verify false', async () => {
    const zeroed = { T, y: 0n, mus: proof.mus.map(() => 0n) }
    const parsed = proofFromBytes(proofToBytes(zeroed, opts), opts)
    expect(parsed.y).toBe(0n)
    expect(await pietrzakVerify(pulse, T, 0n, parsed, opts)).toBe(false)
  })
})

describe('wesolowskiToBytes / wesolowskiFromBytes', () => {
  test('layout, Python bytes, and round trip', async () => {
    const { proofIndex, hex } = fixture.wire.wesolowski
    const p = fixtureWesolowski(proofIndex)
    const encoded = wesolowskiToBytes(p, opts)
    expect(encoded).toHaveLength(HEADER + 2 * WIDTH)
    expect(encoded[1]).toBe(0x57)
    expect(toHex(encoded)).toBe(hex)
    const parsed = wesolowskiFromBytes(encoded, opts)
    expect(parsed).toEqual(p)
    expect(Object.isFrozen(parsed)).toBe(true)
    const c = fixture.wesolowski[proofIndex]
    if (!c) throw new Error('fixture case missing')
    expect(await wesolowskiVerify(fromHex(c.inputHex), c.T, parsed.y, parsed, opts)).toBe(true)
  })

  test('strict parsing: version, fingerprint, length, T', () => {
    const encoded = wesolowskiToBytes(fixtureWesolowski(0), opts)
    const legacy = Uint8Array.from(encoded)
    legacy[0] = 0x01
    expectVdfThrow(() => wesolowskiFromBytes(legacy, opts), 'unsupported_version')
    expectVdfThrow(
      () => wesolowskiFromBytes(encoded, { modulus: { n: TEST_MODULUS.n + 2n } }),
      'modulus_mismatch',
    )
    expectVdfThrow(() => wesolowskiFromBytes(encoded.subarray(0, 40), opts), 'invalid_input')
    expectVdfThrow(() => wesolowskiFromBytes({ length: 2 ** 40 }, opts), 'invalid_input')
    const zero = Uint8Array.from(encoded)
    zero.fill(0, 10, 14)
    expectVdfThrow(() => wesolowskiFromBytes(zero, opts), 'invalid_input')
    expectVdfThrow(
      () => wesolowskiToBytes({ T: 1, y: 1n, pi: TEST_MODULUS.n }, opts),
      'invalid_input',
    )
    expectVdfThrow(
      () => wesolowskiToBytes({ T: 1, y: 1n } as unknown as WesolowskiProof, opts),
      'invalid_input',
    )
  })
})
