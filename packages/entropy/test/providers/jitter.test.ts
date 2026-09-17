import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import {
  JITTER_STARTUP_CLEARCACHE,
  JITTER_STARTUP_LOOPS,
  jitterEntropy,
  jitterStartupTest,
  pickClock,
} from '../../src/providers/jitter.js'
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
    expect(() => pickClock(false, noHrtime)).toThrow(EntropyError)
  })

  test('throws invalid_request when no usable clock exists at all', () => {
    expect(() => pickClock(true, {} as typeof globalThis)).toThrow(EntropyError)
  })
})

/** CLEARCACHE warm-up deltas followed by `loops` generated ones. */
function deltas(generate: (i: number) => number, loops = JITTER_STARTUP_LOOPS): number[] {
  const out: number[] = []
  for (let i = 0; i < JITTER_STARTUP_CLEARCACHE; i++) out.push(generate(i))
  for (let i = 0; i < loops; i++) out.push(generate(i))
  return out
}

describe('jitterStartupTest (jitterentropy jent_time_entropy_init port)', () => {
  let state = 0x9e3779b9
  const noisy = () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return [83, 84, 125, 42, 41, 167, 166, 208][state & 7] as number
  }

  test('passes a fine-grained, varying clock (Apple-Silicon-like delta mix)', () => {
    const report = jitterStartupTest(deltas(noisy))
    expect(report.ok).toBe(true)
    expect(report.samples).toBe(JITTER_STARTUP_LOOPS) // warm-up excluded
    expect(report.reason).toBeUndefined()
  })

  test('fails a clock that does not advance (zero deltas, e.g. a 1 µs VM clock)', () => {
    const report = jitterStartupTest(deltas((i) => (i % 20 === 0 ? 1000 : 0)))
    expect(report.ok).toBe(false)
    expect(report.reason).toContain('zero deltas')
  })

  test('tolerates rare zero deltas (timebase quantization) up to one in ten', () => {
    expect(jitterStartupTest(deltas((i) => (i % 50 === 0 ? 0 : noisy()))).ok).toBe(true)
  })

  test('fails a coarse timer whose deltas are multiples of 100', () => {
    const report = jitterStartupTest(deltas((i) => [100, 200, 300, 500][i % 4] as number))
    expect(report.ok).toBe(false)
    expect(report.reason).toContain('multiples of 100')
  })

  test('fails a stuck clock (constant delta)', () => {
    const report = jitterStartupTest(deltas(() => 125))
    expect(report.ok).toBe(false)
    expect(report.reason).toContain('stuck')
  })

  test('fails a non-monotonic clock', () => {
    const report = jitterStartupTest(deltas((i) => (i % 100 === 1 ? -5 : noisy())))
    expect(report.ok).toBe(false)
    expect(report.reason).toContain('backwards')
  })

  test('fails when the deltas carry no variation to harvest', () => {
    // a linear ramp: every Δ²delta is 0 (stuck), Σ|Δdelta| = N — caught by the stuck rule
    const report = jitterStartupTest(deltas((i) => 1001 + i))
    expect(report.ok).toBe(false)
  })

  test('documented limitation: a two-value alternation passes (left to the health tests)', () => {
    expect(jitterStartupTest(deltas((i) => (i % 2 === 0 ? 83 : 125))).ok).toBe(true)
  })

  test('fails on an empty measurement', () => {
    expect(jitterStartupTest([]).ok).toBe(false)
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

  test('validates batchSamples and conditioning options', () => {
    expect(() => jitterEntropy({ batchSamples: 0 })).toThrow(EntropyError)
    expect(() => jitterEntropy({ batchSamples: 1.5 })).toThrow(EntropyError)
    expect(() => jitterEntropy({ safetyFactor: 0 })).toThrow(EntropyError)
  })

  test('raw output passes through the health tests on this host', async () => {
    const { bytes } = await jitterEntropy({ conditioning: 'raw' }).getBytes(8192, {
      timeoutMs: 60_000,
    })
    expect(bytes).toHaveLength(8192)
  }, 60_000)

  test('conditioned output looks statistically reasonable (loose)', async () => {
    const { bytes } = await jitterEntropy().getBytes(4096, { timeoutMs: 60_000 })
    const counts = new Array(256).fill(0)
    for (const byte of bytes) counts[byte]++
    const distinct = counts.filter((c) => c > 0).length
    expect(distinct).toBeGreaterThan(100)
    expect(Math.max(...counts) / bytes.length).toBeLessThan(0.05)
  }, 60_000)
})
