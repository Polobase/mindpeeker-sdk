import { describe, expect, test } from 'bun:test'
import { cryptoProvider } from '../../src/providers/crypto.js'
import { providerContract } from '../helpers/provider-contract.js'

providerContract('cryptoProvider', () => cryptoProvider(), {
  kind: 'csprng',
  privacy: 'private',
  // 65_537 forces chunking across the 65_536-byte getRandomValues cap
  lengths: [1, 32, 65_537],
})

describe('cryptoProvider specifics', () => {
  test('is named crypto', () => {
    expect(cryptoProvider().name).toBe('crypto')
  })

  test('produces non-constant output (sanity)', async () => {
    const { bytes } = await cryptoProvider().getBytes(64)
    const distinct = new Set(bytes)
    expect(distinct.size).toBeGreaterThan(1)
  })

  test('two calls differ (sanity)', async () => {
    const p = cryptoProvider()
    const a = await p.getBytes(32)
    const b = await p.getBytes(32)
    expect(a.bytes).not.toEqual(b.bytes)
  })
})
