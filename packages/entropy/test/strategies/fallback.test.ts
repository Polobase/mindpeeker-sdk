import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { fallback } from '../../src/strategies/fallback.js'
import { xorMix } from '../../src/strategies/xor.js'
import { providerContract } from '../helpers/provider-contract.js'
import { stub } from '../helpers/stubs.js'

providerContract(
  'fallback(stub, stub)',
  () => fallback([stub({ name: 'a' }).provider, stub({ name: 'b' }).provider]),
  { kind: 'csprng', privacy: 'private' },
)

describe('fallback', () => {
  test('requires at least one provider', () => {
    expect(() => fallback([])).toThrow(TypeError)
  })

  test('first provider wins when it succeeds; later ones are never called', async () => {
    const a = stub({ name: 'a', byte: 7 })
    const b = stub({ name: 'b', byte: 9 })
    const result = await fallback([a.provider, b.provider]).getBytes(4)
    expect(result.bytes).toEqual(new Uint8Array([7, 7, 7, 7]))
    expect(result.sources.map((s) => s.name)).toEqual(['a'])
    expect(a.calls).toEqual([4])
    expect(b.calls).toEqual([])
  })

  test('moves to the next provider on failure', async () => {
    const a = stub({ name: 'a', fail: new EntropyError('network', 'down') })
    const b = stub({ name: 'b', byte: 9 })
    const result = await fallback([a.provider, b.provider]).getBytes(2)
    expect(result.bytes).toEqual(new Uint8Array([9, 9]))
    expect(result.sources.map((s) => s.name)).toEqual(['b'])
  })

  test('moves on when an attempt exceeds attemptTimeoutMs', async () => {
    const a = stub({ name: 'a', hang: true })
    const b = stub({ name: 'b', byte: 5 })
    const result = await fallback([a.provider, b.provider], { attemptTimeoutMs: 30 }).getBytes(2)
    expect(result.bytes).toEqual(new Uint8Array([5, 5]))
    expect(a.signals[0]?.aborted).toBe(true)
  })

  test('aggregates all failures into insufficient_entropy', async () => {
    const a = stub({ name: 'a', fail: new EntropyError('network', 'a down') })
    const b = stub({ name: 'b', fail: new EntropyError('auth', 'b key bad') })
    const err = (await fallback([a.provider, b.provider])
      .getBytes(2)
      .catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('insufficient_entropy')
    const agg = err.cause as AggregateError
    expect(agg).toBeInstanceOf(AggregateError)
    expect(agg.errors.map((e: EntropyError) => e.code)).toEqual(['network', 'auth'])
  })

  test('caller abort rethrows immediately without trying later providers', async () => {
    const a = stub({ name: 'a', hang: true })
    const b = stub({ name: 'b' })
    const controller = new AbortController()
    const pending = fallback([a.provider, b.provider]).getBytes(2, { signal: controller.signal })
    controller.abort()
    const err = (await pending.catch((e) => e)) as EntropyError
    expect(err.code).toBe('aborted')
    expect(b.calls).toEqual([])
  })

  test('overall timeoutMs on the composite surfaces as timeout', async () => {
    const a = stub({ name: 'a', hang: true })
    const b = stub({ name: 'b', hang: true })
    const err = (await fallback([a.provider, b.provider], { attemptTimeoutMs: 10_000 })
      .getBytes(2, { timeoutMs: 40 })
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('timeout')
  })

  test('metadata: common kind is kept, mixed otherwise; privacy is pessimistic', () => {
    const q1 = stub({ name: 'q1', kind: 'qrng' }).provider
    const q2 = stub({ name: 'q2', kind: 'qrng' }).provider
    const beacon = stub({ name: 'bc', kind: 'beacon', privacy: 'public' }).provider
    expect(fallback([q1, q2]).kind).toBe('qrng')
    expect(fallback([q1, q2]).privacy).toBe('private')
    expect(fallback([q1, beacon]).kind).toBe('mixed')
    expect(fallback([q1, beacon]).privacy).toBe('public')
    expect(fallback([q1, beacon]).name).toBe('fallback(q1,bc)')
  })

  test('composes with nested strategies and propagates their attribution', async () => {
    const a = stub({ name: 'a', fail: new EntropyError('network', 'down') })
    const b = stub({ name: 'b', byte: 3 })
    const c = stub({ name: 'c', byte: 5 })
    const nested = fallback([a.provider, xorMix([b.provider, c.provider])])
    const result = await nested.getBytes(2)
    expect(result.bytes).toEqual(new Uint8Array([3 ^ 5, 3 ^ 5]))
    expect(result.sources.map((s) => s.name).sort()).toEqual(['b', 'c'])
  })
})
