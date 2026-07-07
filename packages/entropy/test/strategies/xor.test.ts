import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { xorMix } from '../../src/strategies/xor.js'
import { providerContract } from '../helpers/provider-contract.js'
import { stub } from '../helpers/stubs.js'

providerContract(
  'xorMix(stub, stub)',
  () => xorMix([stub({ name: 'a' }).provider, stub({ name: 'b', byte: 2 }).provider]),
  { kind: 'csprng', privacy: 'private' },
)

describe('xorMix', () => {
  test('requires at least one provider', () => {
    expect(() => xorMix([])).toThrow(TypeError)
  })

  test('xors all member outputs and concatenates attribution', async () => {
    const a = stub({ name: 'a', byte: 0b1010 })
    const b = stub({ name: 'b', byte: 0b0110 })
    const result = await xorMix([a.provider, b.provider]).getBytes(3)
    expect(result.bytes).toEqual(new Uint8Array(3).fill(0b1100))
    expect(result.sources.map((s) => s.name).sort()).toEqual(['a', 'b'])
  })

  test('fails closed: one member failure fails the whole call', async () => {
    const a = stub({ name: 'a', byte: 1 })
    const b = stub({ name: 'b', fail: new EntropyError('network', 'down') })
    const err = (await xorMix([a.provider, b.provider])
      .getBytes(4)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('insufficient_entropy')
    const agg = err.cause as AggregateError
    expect(agg.errors.some((e: EntropyError) => e.code === 'network')).toBe(true)
  })

  test('aborts still-pending members as soon as one fails', async () => {
    const slow = stub({ name: 'slow', hang: true })
    const bad = stub({ name: 'bad', fail: new EntropyError('network', 'down') })
    await xorMix([slow.provider, bad.provider])
      .getBytes(4)
      .catch(() => {})
    expect(slow.signals[0]?.aborted).toBe(true)
  })

  test('caller abort surfaces as aborted', async () => {
    const a = stub({ name: 'a', hang: true })
    const b = stub({ name: 'b', hang: true })
    const controller = new AbortController()
    const pending = xorMix([a.provider, b.provider]).getBytes(2, { signal: controller.signal })
    controller.abort()
    const err = (await pending.catch((e) => e)) as EntropyError
    expect(err.code).toBe('aborted')
  })

  test('privacy: private if ANY member is private; kind mixed when differing', () => {
    const priv = stub({ name: 'p', kind: 'csprng', privacy: 'private' }).provider
    const pub = stub({ name: 'q', kind: 'beacon', privacy: 'public' }).provider
    expect(xorMix([priv, pub]).privacy).toBe('private')
    expect(xorMix([pub, pub]).privacy).toBe('public')
    expect(xorMix([priv, pub]).kind).toBe('mixed')
    expect(xorMix([priv, priv]).kind).toBe('csprng')
    expect(xorMix([priv, pub]).name).toBe('xor(p,q)')
  })

  test('runs members in parallel, not sequentially', async () => {
    const a = stub({ name: 'a', delayMs: 40 })
    const b = stub({ name: 'b', delayMs: 40, byte: 2 })
    const start = Date.now()
    await xorMix([a.provider, b.provider]).getBytes(2)
    expect(Date.now() - start).toBeLessThan(70)
  })
})
