import { describe, expect, test } from 'bun:test'
import { rateFromCharCodes, sha256Hex, signatureToRate } from '../../src/broadcast/signature.js'

describe('signatureToRate', () => {
  test('is deterministic', async () => {
    expect(await signatureToRate('John Doe')).toEqual(await signatureToRate('John Doe'))
  })

  test('differs for different signatures', async () => {
    const a = await signatureToRate('John Doe')
    const b = await signatureToRate('Jane Doe')
    expect(a.digits).not.toEqual(b.digits)
  })

  test('every digit is in [0, base) and length is honoured', async () => {
    for (const base of [10, 44, 336]) {
      const rate = await signatureToRate('subject-witness', { length: 7, base })
      expect(rate.base).toBe(base)
      expect(rate.digits.length).toBe(7)
      for (const d of rate.digits) {
        expect(d).toBeGreaterThanOrEqual(0)
        expect(d).toBeLessThan(base)
      }
    }
  })

  test('defaults to a 6-digit base-44 rate', async () => {
    const rate = await signatureToRate('x')
    expect(rate.base).toBe(44)
    expect(rate.digits.length).toBe(6)
  })
})

describe('rateFromCharCodes', () => {
  test('sqrt of the char-code sum, 2 dp (AetherOne parity)', () => {
    // 'abc' → 97 + 98 + 99 = 294 → √294 = 17.1464… → 17.15
    expect(rateFromCharCodes('abc')).toBe(17.15)
    expect(rateFromCharCodes('')).toBe(0)
    expect(rateFromCharCodes('A')).toBe(Math.round(Math.sqrt(65) * 100) / 100)
  })
})

describe('sha256Hex', () => {
  test('known digest and stable length', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect((await sha256Hex('anything')).length).toBe(64)
  })
})
