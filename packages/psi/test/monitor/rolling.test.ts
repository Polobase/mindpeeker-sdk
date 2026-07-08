import { describe, expect, test } from 'bun:test'
import {
  chiSquareP,
  stoufferZ,
  theoreticalCalibration,
  trialsFromBytes,
  zScores,
} from '@mindpeeker/negentropy'
import { normPpf } from '@mindpeeker/negentropy/numerics'
import type { RollingPoint } from '../../src/monitor/rolling.js'
import { rollingNetvar, rollingStouffer } from '../../src/monitor/rolling.js'
import {
  countingSource,
  fakeClock,
  finiteSource,
  finiteSourceBytes,
} from '../helpers/trial-sources.js'

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
      rollingStouffer(sources(), { windowTrials: 4, hopTrials: 2, now: fakeClock() }),
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
    const points = await collect(rollingStouffer(sources(), { windowTrials: 3 }))
    expect(points.length).toBe(TRIALS - 3 + 1)
  })

  test('abort raises PsiError aborted and closes the sources', async () => {
    const controller = new AbortController()
    const a = countingSource('a')
    const monitor = rollingStouffer([a, countingSource('b')], {
      windowTrials: 2,
      signal: controller.signal,
    })
    const first = await monitor.next()
    expect(first.done).toBe(false)
    controller.abort()
    expect(monitor.next()).rejects.toMatchObject({ name: 'PsiError', code: 'aborted' })
  })

  test('breaking out of the loop is clean (no hang, no further pulls)', async () => {
    const a = countingSource('a')
    const monitor = rollingStouffer([a], { windowTrials: 2 })
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
    expect(() => rollingStouffer([], { windowTrials: 4 })).toThrow(bad)
    expect(() => rollingStouffer([countingSource('a')], { windowTrials: 0 })).toThrow(bad)
    expect(() => rollingStouffer([countingSource('a')], { windowTrials: 4, hopTrials: 0 })).toThrow(
      bad,
    )
    expect(() =>
      rollingStouffer([countingSource('x'), countingSource('x')], { windowTrials: 4 }),
    ).toThrow(bad)
  })
})

describe('rollingNetvar', () => {
  test('windows are batch-identical normal-equivalent z of the χ² tail', async () => {
    const points = await collect(rollingNetvar(sources(), { windowTrials: 5, hopTrials: 5 }))
    expect(points.length).toBe(2)
    const stouffers = batchStouffers()
    const expected = [5, 10].map((end) => {
      let statistic = 0
      for (let t = end - 5; t < end; t++) {
        const z = stouffers[t] as number
        statistic += z * z
      }
      return -normPpf(Math.min(chiSquareP(statistic, 5), 1 - 1e-16))
    })
    points.forEach((point, i) => {
      expect(point.n).toBe(5)
      expect(point.z).toBe(expected[i] as number)
    })
  })

  test('null data yields unremarkable z values', async () => {
    const points = await collect(rollingNetvar(sources(), { windowTrials: 4, hopTrials: 3 }))
    for (const point of points) expect(Math.abs(point.z)).toBeLessThan(4)
  })
})
