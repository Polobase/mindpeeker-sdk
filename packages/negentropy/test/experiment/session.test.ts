import { describe, expect, test } from 'bun:test'
import type { NegentropyError } from '../../src/errors.js'
import { analyzeTrials } from '../../src/experiment/batch.js'
import { registerExperiment } from '../../src/experiment/registration.js'
import type { SessionTick } from '../../src/experiment/session.js'
import { session } from '../../src/experiment/session.js'
import { theoreticalCalibration } from '../../src/stats/calibration.js'
import { villeCrossing } from '../../src/stats/eprocess.js'
import { netvarLogM, netvarMartingale } from '../../src/stats/netvar-martingale.js'
import { stoufferZ } from '../../src/stats/zscores.js'
import type { TrialSource } from '../../src/types.js'
import { countingSource, prngBytes, prngUniforms } from '../helpers/byte-sources.js'

/** Endless source yielding one full 200-bit trial per 25-byte chunk. */
function instantSource(name: string, seed: number): TrialSource {
  return {
    name,
    async *stream() {
      let round = seed
      while (true) yield prngBytes(25, round++)
    },
  }
}

/** Source that yields `count` trials then ends. */
function finiteSource(name: string, count: number, seed: number): TrialSource {
  return {
    name,
    async *stream() {
      for (let i = 0; i < count; i++) yield prngBytes(25, seed + i)
    },
  }
}

/** Source whose stream never produces anything. */
function hangingSource(name: string): TrialSource {
  return {
    name,
    async *stream() {
      await new Promise<never>(() => {})
      yield new Uint8Array(0) // unreachable
    },
  }
}

/** Bit-biased source (p = 0.7 per bit) — theoretical calibration would misread it. */
function biasedSource(name: string, seed: number): TrialSource {
  return {
    name,
    async *stream() {
      let round = seed
      while (true) {
        const uniforms = prngUniforms(200, round++)
        const bytes = new Uint8Array(25)
        for (let t = 0; t < 200; t++) {
          if ((uniforms[t] as number) < 0.7) {
            bytes[t >> 3] = (bytes[t >> 3] as number) | (1 << (7 - (t & 7)))
          }
        }
        yield bytes
      }
    },
  }
}

async function takeTicks(s: AsyncIterable<SessionTick>, n: number): Promise<SessionTick[]> {
  const ticks: SessionTick[] = []
  for await (const tick of s) {
    ticks.push(tick)
    if (ticks.length === n) break
  }
  return ticks
}

describe('session (live)', () => {
  test('lock-step ticks: aligned z vectors, consistent running statistics', async () => {
    const live = session({
      sources: [instantSource('a', 1), instantSource('b', 5000), instantSource('c', 9000)],
      events: [{ id: 'window', statistic: 'netvar', start: 0, end: 5 }],
    })
    const ticks = await takeTicks(live, 8)
    expect(ticks.map((t) => t.step)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    let netvar = 0
    for (const tick of ticks) {
      expect(tick.zBySource.length).toBe(3)
      expect(tick.present).toEqual(['a', 'b', 'c'])
      expect(tick.stouffer).toBeCloseTo(stoufferZ([...tick.zBySource]), 12)
      netvar += tick.stouffer ** 2
      expect(tick.netvar).toBeCloseTo(netvar, 10)
      expect(tick.cumdev).toBeCloseTo(netvar - (tick.step + 1), 10)
    }
    expect(ticks[0]?.activeEvents).toEqual(['window'])
    expect(ticks[6]?.activeEvents).toEqual([])
  })

  test('eValue: the live anytime-valid monitor is the upper Gamma-mixture martingale on cumdev', async () => {
    const run = async (a: TrialSource, b: TrialSource) => {
      const live = session({ sources: [a, b] })
      const ticks = await takeTicks(live, 300)
      live.stop()
      return ticks
    }
    const independent = await run(instantSource('a', 1), instantSource('b', 5000))
    const reference = netvarMartingale(
      independent.map((tick) => tick.stouffer),
      { sided: 'upper' },
    )
    for (const tick of independent) {
      expect(tick.logEValue).toBe(netvarLogM(tick.step + 1, tick.cumdev, { sided: 'upper' }))
      expect(tick.eValue).toBe(Math.exp(tick.logEValue))
      // the batch path sums ΣZ² directly only while ΣZ² < t/2; elsewhere bit for bit
      if (tick.netvar >= (tick.step + 1) / 2)
        expect(tick.logEValue).toBe(reference[tick.step] as number)
      else expect(tick.logEValue).toBeCloseTo(reference[tick.step] as number, 12)
    }
    const logs = (ticks: SessionTick[]) => Float64Array.from(ticks, (tick) => tick.logEValue)
    expect(villeCrossing(logs(independent), 0.05)).toBe(-1)
    // two sources fed identical bytes: Var Z = 2, the variance excess the monitor targets
    const common = await run(instantSource('a', 7), instantSource('b', 7))
    const crossing = villeCrossing(logs(common), 0.05)
    expect(crossing).toBeGreaterThanOrEqual(0)
    expect(common[crossing]?.eValue as number).toBeGreaterThanOrEqual(20)
  })

  test('is lazy: no source I/O before the first tick is pulled', async () => {
    const source = countingSource('lazy')
    const live = session({ sources: [source] })
    expect(source.streamCalls).toBe(0)
    await takeTicks(live, 1)
    expect(source.streamCalls).toBe(1)
    live.stop()
  })

  test('stop() reproduces the live run through the batch core', async () => {
    const live = session({
      sources: [instantSource('a', 11), instantSource('b', 22)],
      events: [{ id: 'all', statistic: 'netvar', start: 0, end: 10 }],
    })
    const ticks = await takeTicks(live, 10)
    const result = live.stop()
    expect(result.series.length).toBe(2)
    expect(result.series[0]?.sums.length).toBe(10)
    expect(result.analysedSteps).toBe(10)
    const event = result.events[0]
    expect(event?.steps).toBe(10)
    // batch netvar over the archived series equals the running live netvar — bit for bit
    expect(event?.value).toBe(ticks[9]?.netvar as number)
    expect(event?.cumulative[9]).toBe(ticks[9]?.cumdev as number)
    expect([...(result.series[0]?.timestamps ?? [])]).toEqual(ticks.map((tick) => tick.at))
    // the documented reproducing call
    expect(
      analyzeTrials(result.series, {
        events: [{ id: 'all', statistic: 'netvar', start: 0, end: 10 }],
        calibration: result.calibration,
      }),
    ).toEqual(result)
  })

  test('abort surfaces as aborted', async () => {
    const controller = new AbortController()
    const live = session({
      sources: [instantSource('a', 31)],
      signal: controller.signal,
    })
    const iterator = live[Symbol.asyncIterator]()
    await iterator.next()
    controller.abort()
    await expect(iterator.next()).rejects.toMatchObject({ code: 'aborted' })
  })

  test("missing 'error': a finite source ends the session with source_ended", async () => {
    const live = session({
      sources: [instantSource('a', 41), finiteSource('mortal', 3, 51)],
    })
    const iterator = live[Symbol.asyncIterator]()
    for (let i = 0; i < 3; i++) await iterator.next()
    try {
      await iterator.next()
      expect.unreachable()
    } catch (error) {
      const err = error as NegentropyError
      expect(err.code).toBe('source_ended')
      expect(err.source).toBe('mortal')
    }
  })

  test("missing 'skip': the roster shrinks and the session ends when all sources end", async () => {
    const live = session({
      sources: [finiteSource('short', 3, 61), finiteSource('long', 6, 71)],
      missing: 'skip',
    })
    const ticks: SessionTick[] = []
    for await (const tick of live) ticks.push(tick)
    expect(ticks.length).toBe(6)
    expect(ticks[1]?.present).toEqual(['short', 'long'])
    expect(ticks[4]?.present).toEqual(['long'])
    expect(Number.isNaN(ticks[4]?.zBySource[0] as number)).toBe(true)
  })

  test("missing 'error': a hanging source times out", async () => {
    const live = session({
      sources: [instantSource('a', 81), hangingSource('frozen')],
      stepTimeoutMs: 40,
    })
    const iterator = live[Symbol.asyncIterator]()
    try {
      await iterator.next()
      expect.unreachable()
    } catch (error) {
      const err = error as NegentropyError
      expect(err.code).toBe('timeout')
      expect(err.source).toBe('frozen')
    }
  })

  test("missing 'skip': slow sources are skipped per round, fast ones keep ticking", async () => {
    const live = session({
      sources: [instantSource('fast', 91), hangingSource('slow')],
      missing: 'skip',
      stepTimeoutMs: 30,
    })
    const ticks = await takeTicks(live, 3)
    for (const tick of ticks) {
      expect(tick.present).toEqual(['fast'])
      expect(Number.isNaN(tick.zBySource[1] as number)).toBe(true)
    }
    live.stop()
  })

  test('live burn-in calibration normalizes a biased source', async () => {
    const live = session({
      sources: [biasedSource('hot', 0x1001), biasedSource('hot2', 0x2002)],
      calibration: { trials: 400 },
    })
    const ticks = await takeTicks(live, 100)
    const result = live.stop()
    expect(result.calibration[0]?.basis).toBe('empirical')
    // p=0.7 bits → mean 140: empirical calibration keeps z near 0;
    // theoretical calibration would put it at (140−100)/√50 ≈ +5.7
    const meanZ = ticks.reduce((a, t) => a + (t.zBySource[0] as number), 0) / ticks.length
    expect(Math.abs(meanZ)).toBeLessThan(1)
    expect(result.series[0]?.sums.length).toBe(100) // burn trials not in the archive
  })

  test('Date event windows activate by wall clock', async () => {
    let fake = 1_000_000
    const live = session({
      sources: [instantSource('a', 111)],
      now: () => {
        fake += 1000
        return fake
      },
      events: [
        {
          id: 'later',
          statistic: 'netvar',
          start: new Date(1_003_000),
          end: new Date(1_006_000),
        },
      ],
    })
    const ticks = await takeTicks(live, 6)
    const activePattern = ticks.map((t) => t.activeEvents.length)
    expect(activePattern.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
    expect(activePattern[0]).toBe(0) // first tick is before the window opens
    live.stop()
  })

  test('a registered experiment embeds its hash in the result', async () => {
    const registration = await registerExperiment({
      events: [{ id: 'e', statistic: 'netvar', start: 0, end: 5 }],
    })
    const live = session({ sources: [instantSource('a', 121)], registration })
    await takeTicks(live, 5)
    const result = live.stop()
    expect(result.registration).toBe(registration.hash)
    expect(result.events.length).toBe(1)
    expect(analyzeTrials(result.series, { registration, calibration: result.calibration })).toEqual(
      result,
    )
  })

  test('a registered burn-in session is reproduced exactly without re-burning', async () => {
    const registration = await registerExperiment({
      calibration: { trials: 20 },
      events: [
        { id: 'e', statistic: 'netvar', start: 0, end: 15 },
        { id: 'late', statistic: 'devvar', start: 10, end: 99 },
      ],
    })
    const live = session({
      sources: [biasedSource('p', 0x3003), biasedSource('q', 0x4004)],
      registration,
    })
    await takeTicks(live, 15)
    const result = live.stop()
    expect(result.calibration.map((c) => c.trials)).toEqual([20, 20])
    expect(result.events.map((e) => e.status)).toEqual(['complete', 'incomplete'])
    expect(analyzeTrials(result.series, { registration, calibration: result.calibration })).toEqual(
      result,
    )
  })

  test('validates configuration up front', () => {
    const code = (fn: () => unknown, expected: string) =>
      expect(fn).toThrow(expect.objectContaining({ code: expected }))
    const a = instantSource('a', 1)
    code(() => session({ sources: [] }), 'invalid_config')
    code(
      () => session({ sources: [instantSource('dup', 1), instantSource('dup', 2)] }),
      'invalid_config',
    )
    code(() => session({ sources: [{ name: 'x' } as TrialSource] }), 'invalid_config')
    for (const stepTimeoutMs of [0, -1, Number.NaN, 2 ** 31, Number.MAX_SAFE_INTEGER]) {
      code(() => session({ sources: [a], stepTimeoutMs }), 'invalid_config')
    }
    const e = { id: 'e', statistic: 'netvar' as const, start: 0, end: 5 }
    code(() => session({ sources: [a], events: [e, e] }), 'invalid_config')
    code(() => session({ sources: [a], events: [{ ...e, start: 5 }] }), 'invalid_window')
    code(
      () => session({ sources: [a], events: [{ ...e, statistic: 'correlation' }] }),
      'invalid_config',
    )
    code(() => session({ sources: [a], events: [{ ...e, statistic: 'covar' }] }), 'invalid_config')
    code(
      () => session({ sources: [a], events: [{ ...e, statistic: 'variance' as never }] }),
      'invalid_config',
    )
    code(() => session({ sources: [a], calibration: { trials: 1 } }), 'invalid_config')
    code(
      () => session({ sources: [a], calibration: [theoreticalCalibration('other')] }),
      'calibration_required',
    )
    code(
      () => session({ sources: [a], calibration: [{ ...theoreticalCalibration('a'), sd: 0 }] }),
      'invalid_config',
    )
    code(() => session({ sources: [a], registration: { hash: 'x' } as never }), 'invalid_config')
  })
})
