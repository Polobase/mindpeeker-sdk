import { describe, expect, test } from 'bun:test'
import { jitterEntropy, pickClock } from '../../src/providers/jitter.js'
import { providerContract } from '../helpers/provider-contract.js'

providerContract('jitterEntropy', () => jitterEntropy(), {
  kind: 'trng',
  privacy: 'private',
  lengths: [1, 16, 33],
})

describe('pickClock', () => {
  test('prefers process.hrtime.bigint when available', () => {
    expect(pickClock(false).kind).toBe('hrtime')
  })

  test('falls back to coarse only with explicit opt-in', () => {
    const noHrtime = { performance } as unknown as typeof globalThis
    expect(pickClock(true, noHrtime).kind).toBe('coarse')
    expect(() => pickClock(false, noHrtime)).toThrow(TypeError)
  })

  test('throws when no usable clock exists at all', () => {
    expect(() => pickClock(true, {} as typeof globalThis)).toThrow(TypeError)
  })
})

describe('jitterEntropy', () => {
  test('is named jitter with kind trng', () => {
    const p = jitterEntropy()
    expect(p.name).toBe('jitter')
    expect(p.kind).toBe('trng')
    expect(p.privacy).toBe('private')
  })

  test('raw mode is named jitter(raw)', () => {
    expect(jitterEntropy({ conditioning: 'raw' }).name).toBe('jitter(raw)')
  })

  test('conditioned output looks statistically reasonable (loose)', async () => {
    const { bytes } = await jitterEntropy().getBytes(4096, { timeoutMs: 60_000 })
    const counts = new Array(256).fill(0)
    for (const byte of bytes) counts[byte]++
    const distinct = counts.filter((c) => c > 0).length
    expect(distinct).toBeGreaterThan(100)
    expect(Math.max(...counts) / bytes.length).toBeLessThan(0.05)
  }, 60_000)
})
