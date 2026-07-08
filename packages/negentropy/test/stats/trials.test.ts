import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { trialStream, trialsFromBytes } from '../../src/stats/trials.js'
import type { Trial, TrialSource } from '../../src/types.js'
import { chunkSource, countingSource, prngBytes } from '../helpers/byte-sources.js'

describe('trialsFromBytes', () => {
  test('known answers on constant and alternating bytes', () => {
    const zeros = trialsFromBytes(new Uint8Array(100).fill(0x00), 's', { bitsPerTrial: 200 })
    expect([...zeros.sums]).toEqual([0, 0, 0, 0])
    const ones = trialsFromBytes(new Uint8Array(50).fill(0xff), 's', { bitsPerTrial: 200 })
    expect([...ones.sums]).toEqual([200, 200])
    const alternating = trialsFromBytes(new Uint8Array(25).fill(0xaa), 's', { bitsPerTrial: 200 })
    expect([...alternating.sums]).toEqual([100])
  })

  test('hand-computed vector with k=16', () => {
    // popcounts: 0x01→1, 0x03→2, 0x07→3, 0x0F→4; k=16 pairs bytes → [1+2, 3+4]
    const series = trialsFromBytes(new Uint8Array([0x01, 0x03, 0x07, 0x0f]), 's', {
      bitsPerTrial: 16,
    })
    expect([...series.sums]).toEqual([3, 7])
    expect(series.leftoverBits).toBe(0)
  })

  test('drops and reports trailing bits, never pads', () => {
    const series = trialsFromBytes(new Uint8Array(30).fill(0xff), 's', { bitsPerTrial: 200 })
    expect(series.sums.length).toBe(1)
    expect(series.leftoverBits).toBe(40)
  })

  test('non-byte-aligned k matches a naive bit-loop reference', () => {
    const bytes = prngBytes(1000, 0x1234)
    const k = 13
    const series = trialsFromBytes(bytes, 's', { bitsPerTrial: k })
    // naive reference: expand to bits MSB-first, sum runs of k
    const bits: number[] = []
    for (const byte of bytes) for (let b = 7; b >= 0; b--) bits.push((byte >> b) & 1)
    const expected: number[] = []
    for (let i = 0; i + k <= bits.length; i += k) {
      expected.push(bits.slice(i, i + k).reduce((a, b) => a + b, 0))
    }
    expect([...series.sums]).toEqual(expected)
    expect(series.leftoverBits).toBe(8000 - expected.length * k)
  })

  test('byte-aligned fast path matches the naive reference too', () => {
    const bytes = prngBytes(500, 0x777)
    const series = trialsFromBytes(bytes, 's', { bitsPerTrial: 32 })
    const bits: number[] = []
    for (const byte of bytes) for (let b = 7; b >= 0; b--) bits.push((byte >> b) & 1)
    const expected: number[] = []
    for (let i = 0; i + 32 <= bits.length; i += 32) {
      expected.push(bits.slice(i, i + 32).reduce((a, b) => a + b, 0))
    }
    expect([...series.sums]).toEqual(expected)
  })

  test('null distribution: mean ≈ k/2, variance ≈ k/4', () => {
    const k = 200
    const series = trialsFromBytes(prngBytes(2_500_000), 's', { bitsPerTrial: k })
    const n = series.sums.length
    expect(n).toBe(100_000)
    let sum = 0
    for (const s of series.sums) sum += s
    const mean = sum / n
    let m2 = 0
    for (const s of series.sums) m2 += (s - mean) ** 2
    const variance = m2 / (n - 1)
    // CLT bounds: sd(mean) = √(50/n), sd(var) ≈ 50√(2/n)
    expect(Math.abs(mean - 100)).toBeLessThan(4 * Math.sqrt(50 / n))
    expect(Math.abs(variance - 50)).toBeLessThan(4 * 50 * Math.sqrt(2 / n))
  })

  test('rejects bad bitsPerTrial', () => {
    for (const k of [0, 4, 7, 12.5, Number.NaN]) {
      expect(() => trialsFromBytes(new Uint8Array(8), 's', { bitsPerTrial: k })).toThrow(
        NegentropyError,
      )
      try {
        trialsFromBytes(new Uint8Array(8), 's', { bitsPerTrial: k })
      } catch (error) {
        expect((error as NegentropyError).code).toBe('invalid_config')
      }
    }
  })
})

async function collect(stream: AsyncGenerator<Trial>, n: number): Promise<Trial[]> {
  const out: Trial[] = []
  for await (const trial of stream) {
    out.push(trial)
    if (out.length === n) break
  }
  return out
}

describe('trialStream (count mode)', () => {
  test('is lazy: no source I/O before the first next()', async () => {
    const source = countingSource('lazy')
    const stream = trialStream(source, { bitsPerTrial: 200 })
    expect(source.streamCalls).toBe(0)
    expect(source.pulls).toBe(0)
    await stream.next()
    expect(source.streamCalls).toBe(1)
    expect(source.pulls).toBeGreaterThan(0)
    await stream.return(undefined)
  })

  test('assembles trials across chunk boundaries', async () => {
    // 200-bit trials from 7-byte chunks: trial boundary falls mid-byte-run
    const bytes = prngBytes(100, 0xbeef)
    const chunks: Uint8Array[] = []
    for (let i = 0; i < bytes.length; i += 7) chunks.push(bytes.slice(i, i + 7))
    const trials = await collect(trialStream(chunkSource('s', chunks), { bitsPerTrial: 200 }), 4)
    const reference = trialsFromBytes(bytes, 's', { bitsPerTrial: 200 })
    expect(trials.map((t) => t.sum)).toEqual([...reference.sums])
    expect(trials.map((t) => t.index)).toEqual([0, 1, 2, 3])
    for (const t of trials) expect(typeof t.at).toBe('number')
  })

  test('ends when the source ends', async () => {
    const trials = await collect(
      trialStream(chunkSource('s', [prngBytes(30)]), { bitsPerTrial: 200 }),
      10,
    )
    expect(trials.length).toBe(1) // 240 bits → one full trial
  })

  test('abort surfaces as code aborted', async () => {
    const controller = new AbortController()
    const stream = trialStream(countingSource('s'), {
      bitsPerTrial: 200,
      signal: controller.signal,
    })
    await stream.next()
    controller.abort()
    expect(stream.next()).rejects.toMatchObject({ name: 'NegentropyError', code: 'aborted' })
  })

  test('pre-aborted signal throws before any I/O', async () => {
    const source = countingSource('s')
    const stream = trialStream(source, { signal: AbortSignal.abort() })
    expect(stream.next()).rejects.toMatchObject({ code: 'aborted' })
    expect(source.streamCalls).toBe(0)
  })

  test('source errors surface as source_failed with cause and source name', async () => {
    const boom = new Error('device unplugged')
    const stream = trialStream(chunkSource('esp32', [prngBytes(25)], { errorAfter: boom }), {
      bitsPerTrial: 200,
    })
    await stream.next()
    try {
      await stream.next()
      expect.unreachable()
    } catch (error) {
      const err = error as NegentropyError
      expect(err.code).toBe('source_failed')
      expect(err.source).toBe('esp32')
      expect(err.cause).toBe(boom)
    }
  })
})

describe('trialStream (interval mode)', () => {
  function pacedSource(msPerChunk: number, tick: { t: number }): TrialSource {
    let round = 1
    return {
      name: 'paced',
      async *stream() {
        while (true) {
          tick.t += msPerChunk
          yield prngBytes(25, round++)
        }
      },
    }
  }

  test('one trial per bucket, extras discarded, bucket-relative indexes', async () => {
    const tick = { t: 0 }
    // 25-byte chunks (one full 200-bit trial each) every 250ms, 1s buckets
    const trials = await collect(
      trialStream(pacedSource(250, tick), {
        bitsPerTrial: 200,
        clock: { mode: 'interval', intervalMs: 1000 },
        now: () => tick.t,
      }),
      3,
    )
    // chunks land at t=250(b0), 500, 750, 1000(b1), … → first fill per bucket wins
    expect(trials.map((t) => t.index)).toEqual([0, 1, 2])
    expect(trials.map((t) => t.at)).toEqual([250, 1000, 2000])
  })

  test('a skipped bucket appears as an index gap', async () => {
    const tick = { t: 0 }
    // chunk cadence 1700ms with 1s buckets: buckets 1, 3, 5, 6, 8 get data — gaps elsewhere
    const trials = await collect(
      trialStream(pacedSource(1700, tick), {
        bitsPerTrial: 200,
        clock: { mode: 'interval', intervalMs: 1000 },
        now: () => tick.t,
      }),
      4,
    )
    // arrivals at 1700(b1), 3400(b3), 5100(b5), 6800(b6) → relative 0, 2, 4, 5
    expect(trials.map((t) => t.index)).toEqual([0, 2, 4, 5])
  })

  test('underfilled buckets yield no trial', async () => {
    const tick = { t: 0 }
    // 10-byte chunks (80 bits) every 600ms: a 1s bucket sees at most 2 chunks = 160 bits < 200
    const source: TrialSource = {
      name: 'thin',
      async *stream() {
        for (let i = 1; i <= 20; i++) {
          tick.t += 600
          yield prngBytes(10, i)
        }
      },
    }
    const trials: Trial[] = []
    for await (const trial of trialStream(source, {
      bitsPerTrial: 200,
      clock: { mode: 'interval', intervalMs: 1000 },
      now: () => tick.t,
    })) {
      trials.push(trial)
    }
    expect(trials.length).toBe(0)
  })

  test('rejects a non-positive interval', () => {
    const stream = trialStream(countingSource('s'), {
      clock: { mode: 'interval', intervalMs: 0 },
    })
    expect(stream.next()).rejects.toMatchObject({ code: 'invalid_config' })
  })
})
