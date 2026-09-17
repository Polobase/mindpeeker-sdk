import { describe, expect, test } from 'bun:test'
import {
  chiSquareP,
  stoufferZ,
  theoreticalCalibration,
  trialsFromBytes,
  zScores,
} from '@mindpeeker/negentropy'
import { chi2Cdf, normPpf } from '@mindpeeker/negentropy/numerics'
import type { RollingPoint } from '../../src/monitor/rolling.js'
import { rollingNetvar, rollingStouffer } from '../../src/monitor/rolling.js'
import type { TrialSource } from '../../src/types.js'
import {
  chunkSource,
  countingSource,
  fakeClock,
  finiteSource,
  finiteSourceBytes,
} from '../helpers/trial-sources.js'

/** Constant-byte source: `count` chunks of `bytes` copies of `value`. */
function constantSource(name: string, value: number, count: number, bytes = 25): TrialSource {
  return chunkSource(
    name,
    Array.from({ length: count }, () => new Uint8Array(bytes).fill(value)),
  )
}

const SEED_A = 11
const SEED_B = 5000
const TRIALS = 10

function sources() {
  // one 25-byte chunk = one 200-bit trial
  return [finiteSource('a', TRIALS, SEED_A), finiteSource('b', TRIALS, SEED_B)]
}

/** Batch recomputation of the per-step Stouffer z's the monitors consume. */
function batchStouffers(): Float64Array {
  const zBySource = [
    trialsFromBytes(finiteSourceBytes(TRIALS, SEED_A), 'a'),
    trialsFromBytes(finiteSourceBytes(TRIALS, SEED_B), 'b'),
  ].map((s) => zScores(s, theoreticalCalibration(s.source)))
  const out = new Float64Array(TRIALS)
  const column = new Float64Array(2)
  for (let t = 0; t < TRIALS; t++) {
    for (let i = 0; i < 2; i++) column[i] = (zBySource[i] as Float64Array)[t] as number
    out[t] = stoufferZ(column)
  }
  return out
}

async function collect(points: AsyncGenerator<RollingPoint>): Promise<RollingPoint[]> {
  const out: RollingPoint[] = []
  for await (const point of points) out.push(point)
  return out
}

describe('rollingStouffer', () => {
  test('windows are batch-identical: window 4, hop 2', async () => {
    const points = await collect(
      rollingStouffer(sources(), { windowSize: 4, hopSize: 2, now: fakeClock() }),
    )
    expect(points.length).toBe(4) // emissions after ticks 4, 6, 8, 10
    const stouffers = batchStouffers()
    const expected = [4, 6, 8, 10].map((end) => stoufferZ(stouffers.slice(end - 4, end)))
    points.forEach((point, i) => {
      expect(point.n).toBe(4)
      expect(point.z).toBe(expected[i] as number) // exact — identical arithmetic
    })
    for (let i = 1; i < points.length; i++) {
      expect(points[i]?.at).toBeGreaterThan(points[i - 1]?.at as number)
    }
  })

  test('hop defaults to 1: one emission per tick once the window fills', async () => {
    const points = await collect(rollingStouffer(sources(), { windowSize: 3 }))
    expect(points.length).toBe(TRIALS - 3 + 1)
  })

  test('abort raises PsiError aborted and closes the sources', async () => {
    const controller = new AbortController()
    const a = countingSource('a')
    const monitor = rollingStouffer([a, countingSource('b')], {
      windowSize: 2,
      signal: controller.signal,
    })
    const first = await monitor.next()
    expect(first.done).toBe(false)
    controller.abort()
    await expect(monitor.next()).rejects.toMatchObject({ name: 'PsiError', code: 'aborted' })
  })

  test('breaking out of the loop is clean (no hang, no further pulls)', async () => {
    const a = countingSource('a')
    const monitor = rollingStouffer([a], { windowSize: 2 })
    for await (const point of monitor) {
      expect(point.n).toBe(2)
      break
    }
    const pullsAfterBreak = a.pulls
    await Bun.sleep(5)
    expect(a.pulls).toBe(pullsAfterBreak)
  })

  test('invalid options are rejected eagerly', () => {
    const bad = expect.objectContaining({
      name: 'PsiError',
      code: 'invalid_plan',
    }) as unknown as Error
    const a = countingSource('a')
    expect(() => rollingStouffer([], { windowSize: 4 })).toThrow(bad)
    expect(() => rollingStouffer([a], { windowSize: 0 })).toThrow(bad)
    expect(() => rollingStouffer([a], { windowSize: 4, hopSize: 0 })).toThrow(bad)
    expect(() =>
      rollingStouffer([countingSource('x'), countingSource('x')], { windowSize: 4 }),
    ).toThrow(bad)
    for (const bitsPerTrial of [4, 8.5, Number.NaN]) {
      expect(() => rollingNetvar([a], { windowSize: 4, bitsPerTrial })).toThrow(bad)
    }
    for (const stepTimeoutMs of [0, -5, Number.NaN, 2 ** 31]) {
      expect(() => rollingStouffer([a], { windowSize: 4, stepTimeoutMs })).toThrow(bad)
    }
    // biome-ignore lint/suspicious/noExplicitAny: the 0.1.x option name is gone
    expect(() => rollingStouffer([a], { windowTrials: 4 } as any)).toThrow(bad)
    expect(() =>
      rollingStouffer([a], { windowSize: 4, stepTimeoutMs: Number.POSITIVE_INFINITY }),
    ).not.toThrow()
    expect(a.streamCalls).toBe(0)
  })

  test('sourceCount tracks the roster when a source ends', async () => {
    const points = await collect(
      rollingStouffer([finiteSource('a', 3, SEED_A), finiteSource('b', 6, SEED_B)], {
        windowSize: 1,
      }),
    )
    expect(points.map((p) => p.sourceCount)).toEqual([2, 2, 2, 1, 1, 1])
  })

  test('a source that ends its stream on abort still yields PsiError aborted', async () => {
    const controller = new AbortController()
    const polite: TrialSource = {
      name: 'polite',
      async *stream(opts) {
        let seed = 1
        while (!opts?.signal?.aborted) {
          yield new Uint8Array(25).fill(seed++ & 0xff)
          await Bun.sleep(1)
        }
      },
    }
    const monitor = rollingStouffer([polite], { windowSize: 1, signal: controller.signal })
    expect((await monitor.next()).done).toBe(false)
    controller.abort()
    await expect(
      (async () => {
        for await (const _ of monitor) {
          // drain
        }
      })(),
    ).rejects.toMatchObject({ name: 'PsiError', code: 'aborted' })
  })
})

describe('rollingNetvar', () => {
  test('windows are batch-identical normal-equivalent z of the χ² tail', async () => {
    const points = await collect(rollingNetvar(sources(), { windowSize: 5, hopSize: 5 }))
    expect(points.length).toBe(2)
    const stouffers = batchStouffers()
    const expected = [5, 10].map((end) => {
      let statistic = 0
      for (let t = end - 5; t < end; t++) {
        const z = stouffers[t] as number
        statistic += z * z
      }
      const upper = chiSquareP(statistic, 5)
      return upper < 0.5 ? -normPpf(upper) : normPpf(chi2Cdf(statistic, 5))
    })
    points.forEach((point, i) => {
      expect(point.n).toBe(5)
      expect(point.sourceCount).toBe(2)
      expect(point.z).toBe(expected[i] as number)
    })
  })

  test('exact discrete floor at S = 0 instead of the old z = −8.21 clamp', async () => {
    // 0x0F bytes: every 200-bit trial has exactly 100 ones → Z_s = 0 → S = 0.
    // Reference: C(200,100)/2^200 = 0.05634847900925642 and Python's NormalDist.inv_cdf.
    const one = await collect(rollingNetvar([constantSource('a', 0x0f, 4)], { windowSize: 1 }))
    expect(one.length).toBe(4)
    for (const point of one) expect(point.z).toBeCloseTo(-1.5861867259848113, 12)
    const three = await collect(rollingNetvar([constantSource('a', 0x0f, 4)], { windowSize: 3 }))
    for (const point of three) expect(point.z).toBeCloseTo(-3.5693779554471723, 12)
    // two sources: Binomial(400, ½) at 200 = 0.03986930196379293
    const pair = await collect(
      rollingNetvar([constantSource('a', 0x0f, 3), constantSource('b', 0xf0, 3)], {
        windowSize: 2,
      }),
    )
    for (const point of pair) expect(point.z).toBeCloseTo(-2.9498655448476128, 12)
  })

  test('odd N·k floor: sums 4/5 of 9 bits give S = w/9 with mass 2·C(9,4)/2⁹ per step', async () => {
    const points = await collect(
      rollingNetvar([constantSource('odd', 0x55, 8, 9)], { windowSize: 2, bitsPerTrial: 9 }),
    )
    expect(points.length).toBeGreaterThan(0)
    for (const point of points) expect(point.z).toBeCloseTo(-0.6990879473017809, 12)
  })

  test('long zero windows use the log-space floor without underflow', async () => {
    const points = await collect(
      rollingNetvar([constantSource('a', 0x0f, 401)], { windowSize: 400, hopSize: 400 }),
    )
    expect(points.length).toBe(1)
    // lnP = 400·ln(0.05634…) = −1150.48; asymptotic ln Φ series solved in Python: z = −47.8684
    expect(points[0]?.z).toBeCloseTo(-47.868406743673546, 3)
  })

  test('null data yields unremarkable z values', async () => {
    const points = await collect(rollingNetvar(sources(), { windowSize: 4, hopSize: 3 }))
    for (const point of points) expect(Math.abs(point.z)).toBeLessThan(4)
  })
})
