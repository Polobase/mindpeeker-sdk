import { describe, expect, test } from 'bun:test'
import type { BeaconSeal } from '../src/beacon.js'
import { sealBeacon, verifySeal } from '../src/beacon.js'
import { expectVdfError } from './helpers/expect.js'
import { TEST_MODULUS } from './helpers/test-modulus.js'

const pulse = new TextEncoder().encode('nist-pulse 2026-07-08T12:00:00Z')
const opts = { modulus: TEST_MODULUS }

const seal = await sealBeacon(pulse, 1000, opts)

describe('sealBeacon', () => {
  test('produces a self-consistent frozen seal', () => {
    expect(seal.T).toBe(1000)
    expect(seal.y).toBe(seal.proof.y)
    expect(seal.T).toBe(seal.proof.T)
    expect(Object.isFrozen(seal)).toBe(true)
  })

  test('is deterministic: same pulse and T give the same seal', async () => {
    const again = await sealBeacon(pulse, 1000, opts)
    expect(again.y).toBe(seal.y)
    expect(again.proof.mus).toEqual(seal.proof.mus as bigint[])
  })
})

describe('verifySeal', () => {
  test('accepts an honest seal', async () => {
    expect(await verifySeal(pulse, seal, opts)).toBe(true)
  })

  test('rejects a tampered pulse', async () => {
    const tampered = Uint8Array.from(pulse)
    tampered[0] = (tampered[0] as number) ^ 0x01
    expect(await verifySeal(tampered, seal, opts)).toBe(false)
  })

  test('rejects internal inconsistency between seal and proof', async () => {
    expect(await verifySeal(pulse, { T: 999, y: seal.y, proof: seal.proof }, opts)).toBe(false)
    expect(await verifySeal(pulse, { T: seal.T, y: seal.y ^ 1n, proof: seal.proof }, opts)).toBe(
      false,
    )
  })

  test('rejects untrusted out-of-range T as false, not a throw', async () => {
    const forged = { T: 0, y: seal.y, proof: { T: 0, y: seal.y, mus: [] } }
    expect(await verifySeal(pulse, forged, opts)).toBe(false)
    const fractional = { T: 1.5, y: seal.y, proof: { T: 1.5, y: seal.y, mus: [] } }
    expect(await verifySeal(pulse, fractional, opts)).toBe(false)
  })

  test('throws invalid_input only for structurally malformed seals', async () => {
    await expectVdfError(verifySeal(pulse, null as unknown as BeaconSeal, opts), 'invalid_input')
    await expectVdfError(
      verifySeal(pulse, { T: 8, y: 5n } as unknown as BeaconSeal, opts),
      'invalid_input',
    )
    await expectVdfError(
      verifySeal(pulse, { T: 8, y: '5', proof: seal.proof } as unknown as BeaconSeal, opts),
      'invalid_input',
    )
  })
})
