import { describe, expect, test } from 'bun:test'
import type { BeaconSeal } from '../src/beacon.js'
import { sealBeacon } from '../src/beacon.js'
import { readU32be } from '../src/internal/bigint.js'
import { sha256 } from '../src/internal/sha256.js'
import { sealFromBytes, sealToBytes, verifySealBytes } from '../src/seal-bytes.js'
import { expectVdfError, expectVdfThrow } from './helpers/expect.js'
import { fromHex, loadFixture, toHex } from './helpers/fixture.js'
import { TEST_MODULUS } from './helpers/test-modulus.js'

const fixture = loadFixture()
const opts = { modulus: TEST_MODULUS }
const WIDTH = 32
const HEADER = 46
const pulse = fromHex(fixture.wire.seal.pulseHex)

const seal = await sealBeacon(pulse, 1000, opts)
const bytes = sealToBytes(seal, pulse, opts)

describe('sealToBytes', () => {
  test('layout: version, kind S, fingerprint, SHA-256(pulse), T, y, midpoints', async () => {
    expect(bytes[0]).toBe(0x02)
    expect(bytes[1]).toBe(0x53)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', pulse as BufferSource))
    expect(toHex(bytes.subarray(10, 42))).toBe(toHex(digest))
    expect(readU32be(bytes, 42)).toBe(1000)
    expect(bytes).toHaveLength(HEADER + WIDTH * (1 + seal.proof.mus.length))
  })

  test('matches the Python encoding byte for byte', () => {
    const w = fixture.wire.seal
    const pySeal: BeaconSeal = {
      T: w.T,
      y: BigInt(w.y),
      proof: { T: w.T, y: BigInt(w.y), mus: w.mus.map(BigInt) },
    }
    expect(toHex(sealToBytes(pySeal, pulse, opts))).toBe(w.hex)
  })

  test('rejects inconsistent seals', () => {
    expectVdfThrow(() => sealToBytes({ ...seal, T: 999 }, pulse, opts), 'invalid_input')
    expectVdfThrow(() => sealToBytes({ ...seal, y: seal.y + 1n }, pulse, opts), 'invalid_input')
    expectVdfThrow(
      () =>
        sealToBytes(
          { ...seal, proof: { ...seal.proof, mus: seal.proof.mus.slice(1) } },
          pulse,
          opts,
        ),
      'invalid_input',
    )
    expectVdfThrow(() => sealToBytes(null as unknown as BeaconSeal, pulse, opts), 'invalid_input')
  })
})

describe('sealFromBytes', () => {
  test('round-trips the seal and exposes the pulse digest', () => {
    const decoded = sealFromBytes(bytes, opts)
    expect(decoded.seal.T).toBe(seal.T)
    expect(decoded.seal.y).toBe(seal.y)
    expect(decoded.seal.proof.mus).toEqual(seal.proof.mus as bigint[])
    expect(toHex(decoded.pulseDigest)).toBe(toHex(sha256(pulse)))
    expect(Object.isFrozen(decoded)).toBe(true)
    expect(Object.isFrozen(decoded.seal)).toBe(true)
  })

  test('strict: version, modulus, kind, length (before allocation), T', () => {
    const legacy = Uint8Array.from(bytes)
    legacy[0] = 0x01
    expectVdfThrow(() => sealFromBytes(legacy, opts), 'unsupported_version')
    expectVdfThrow(
      () => sealFromBytes(bytes, { modulus: { n: TEST_MODULUS.n + 2n } }),
      'modulus_mismatch',
    )
    const kind = Uint8Array.from(bytes)
    kind[1] = 0x50
    expectVdfThrow(() => sealFromBytes(kind, opts), 'invalid_input')
    expectVdfThrow(() => sealFromBytes({ length: 2 ** 40 }, opts), 'invalid_input')
    expectVdfThrow(() => sealFromBytes(bytes.subarray(0, bytes.length - 1), opts), 'invalid_input')
    const zero = Uint8Array.from(bytes)
    zero.fill(0, 42, 46)
    expectVdfThrow(() => sealFromBytes(zero, opts), 'invalid_input')
  })
})

describe('verifySealBytes', () => {
  test('accepts the honest seal bytes and the Python seal bytes', async () => {
    expect(await verifySealBytes(pulse, bytes, opts)).toBe(true)
    expect(await verifySealBytes(pulse, fromHex(fixture.wire.seal.hex), opts)).toBe(true)
  })

  test('returns false for another pulse (digest mismatch) or a tampered element', async () => {
    const other = Uint8Array.from(pulse)
    other[0] = (other[0] as number) ^ 1
    expect(await verifySealBytes(other, bytes, opts)).toBe(false)
    const tampered = Uint8Array.from(bytes)
    tampered[HEADER + WIDTH - 1] = (tampered[HEADER + WIDTH - 1] as number) ^ 1
    expect(await verifySealBytes(pulse, tampered, opts)).toBe(false)
  })

  test('throws for malformed bytes', async () => {
    await expectVdfError(verifySealBytes(pulse, new Uint8Array([0x02]), opts), 'invalid_input')
  })
})
