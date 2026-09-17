import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { rateFromCharCodes, sha256Hex, signatureToRate } from '../../src/broadcast/signature.js'
import { bump, chiSquare } from '../helpers/byte-sources.js'

const fx = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'signature.json'), 'utf8'),
) as { cases: { signature: string; length: number; base: number; digits: number[] }[] }

describe('signatureToRate', () => {
  test('matches the independent Python derivation (hashlib, NFC, rejection)', async () => {
    for (const c of fx.cases) {
      const rate = await signatureToRate(c.signature, { length: c.length, base: c.base })
      expect(rate.base).toBe(c.base)
      expect([...rate.digits]).toEqual(c.digits)
    }
  })

  test('NFC-equivalent signatures give the same rate', async () => {
    const nfc = `caf${String.fromCodePoint(0xe9)}`
    const nfd = `cafe${String.fromCodePoint(0x301)}`
    expect(nfc).not.toBe(nfd)
    expect(await signatureToRate(nfc)).toEqual(await signatureToRate(nfd))
  })

  test('long rates do not repeat the digest; base 336 reaches every digit', async () => {
    const long = await signatureToRate('Arnica montana', { length: 64 })
    expect(long.digits.slice(32, 40)).not.toEqual(long.digits.slice(0, 8))
    const seen = new Set<number>()
    for (let i = 0; i < 400 && seen.size < 336; i++) {
      for (const d of (await signatureToRate(`s${i}`, { length: 32, base: 336 })).digits)
        seen.add(d)
    }
    expect(seen.size).toBe(336)
  })

  test('base-44 digits are uniform over many signatures (chi-square)', async () => {
    const counts = new Array<number>(44).fill(0)
    for (let i = 0; i < 1000; i++) {
      for (const d of (await signatureToRate(`subject-${i}`, { length: 22 })).digits)
        bump(counts, d)
    }
    // 22 000 digits; dof 43, 0.999 quantile ≈ 77.4
    expect(chiSquare(counts, new Array<number>(44).fill(500))).toBeLessThan(80)
  })

  test('defaults to a frozen 6-digit base-44 rate', async () => {
    const rate = await signatureToRate('x')
    expect(rate.base).toBe(44)
    expect(rate.digits.length).toBe(6)
    expect(Object.isFrozen(rate.digits)).toBe(true)
  })

  test('validates length, base, and the signature type', async () => {
    for (const opts of [
      { length: 0 },
      { length: 4097 },
      { length: 2.5 },
      { base: 1 },
      { base: 2 ** 32 + 1 },
    ]) {
      await expect(signatureToRate('x', opts)).rejects.toMatchObject({ code: 'invalid_options' })
    }
    await expect(signatureToRate(42 as never)).rejects.toMatchObject({ code: 'invalid_target' })
  })
})

describe('rateFromCharCodes', () => {
  test('sqrt of the char-code sum, 2 dp (AetherOne parity)', () => {
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
