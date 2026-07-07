import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { race } from '../../src/strategies/race.js'
import { providerContract } from '../helpers/provider-contract.js'
import { stub } from '../helpers/stubs.js'

providerContract(
  'race(stub, stub)',
  () => race([stub({ name: 'a' }).provider, stub({ name: 'b', byte: 2 }).provider]),
  { kind: 'csprng', privacy: 'private' },
)

describe('race', () => {
  test('requires at least one provider', () => {
    expect(() => race([])).toThrow(TypeError)
  })

  test('fastest provider wins and losers are cancelled', async () => {
    const fast = stub({ name: 'fast', byte: 3, delayMs: 5 })
    const slow = stub({ name: 'slow', byte: 9, hang: true })
    const result = await race([fast.provider, slow.provider]).getBytes(2)
    expect(result.bytes).toEqual(new Uint8Array([3, 3]))
    expect(result.sources.map((s) => s.name)).toEqual(['fast'])
    expect(slow.signals[0]?.aborted).toBe(true)
  })

  test('a fast failure does not spoil a slower success', async () => {
    const bad = stub({ name: 'bad', fail: new EntropyError('network', 'down') })
    const ok = stub({ name: 'ok', byte: 4, delayMs: 20 })
    const result = await race([bad.provider, ok.provider]).getBytes(2)
    expect(result.bytes).toEqual(new Uint8Array([4, 4]))
  })

  test('all failures aggregate into insufficient_entropy', async () => {
    const a = stub({ name: 'a', fail: new EntropyError('network', 'a down') })
    const b = stub({ name: 'b', fail: new EntropyError('auth', 'b bad key') })
    const err = (await race([a.provider, b.provider])
      .getBytes(2)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('insufficient_entropy')
    expect(err.cause).toBeInstanceOf(AggregateError)
  })

  test('caller abort surfaces as aborted', async () => {
    const a = stub({ name: 'a', hang: true })
    const controller = new AbortController()
    const pending = race([a.provider]).getBytes(2, { signal: controller.signal })
    controller.abort()
    const err = (await pending.catch((e) => e)) as EntropyError
    expect(err.code).toBe('aborted')
  })

  test('metadata mirrors fallback: pessimistic privacy, common-else-mixed kind', () => {
    const q = stub({ name: 'q', kind: 'qrng' }).provider
    const bc = stub({ name: 'bc', kind: 'beacon', privacy: 'public' }).provider
    expect(race([q, bc]).privacy).toBe('public')
    expect(race([q, bc]).kind).toBe('mixed')
    expect(race([q, bc]).name).toBe('race(q,bc)')
  })
})
