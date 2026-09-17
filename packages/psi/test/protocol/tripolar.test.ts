import { describe, expect, test } from 'bun:test'
import { stoufferZ, theoreticalCalibration, zScores } from '@mindpeeker/negentropy'
import { normPpf } from '@mindpeeker/negentropy/numerics'
import type { TripolarRun } from '../../src/protocol/tripolar.js'
import {
  analyzeTripolar,
  controlContrast,
  runTripolar,
  tripolarSchedule,
  tripolarScheduleDigest,
} from '../../src/protocol/tripolar.js'
import type { Intention, TrialSource } from '../../src/types.js'
import { chunkSource, countingSource, fakeClock, finiteSource } from '../helpers/trial-sources.js'

/** Constant-byte source: `count` chunks of `bytes` copies of `value`. */
function constantSource(name: string, value: number, count: number, bytes = 2): TrialSource {
  return chunkSource(
    name,
    Array.from({ length: count }, () => new Uint8Array(bytes).fill(value)),
  )
}

async function collect(runs: AsyncGenerator<TripolarRun>): Promise<TripolarRun[]> {
  const out: TripolarRun[] = []
  for await (const run of runs) out.push(run)
  return out
}

/** Build a synthetic run whose trials all share one sum — hand-computable analysis. */
function constantRun(
  intention: Intention,
  run: number,
  sequence: number,
  sum: number,
  trials: number,
  bitsPerTrial = 100,
  source = 'reg',
): TripolarRun {
  return {
    intention,
    run,
    sequence,
    series: {
      source,
      bitsPerTrial,
      sums: new Float64Array(trials).fill(sum),
    },
  }
}

describe('runTripolar', () => {
  test('interleaved schedule tags runs high → low → baseline per cycle', async () => {
    const runs = await collect(
      runTripolar(
        finiteSource('reg', 30, 7, 2),
        { trialsPerRun: 3, bitsPerTrial: 16, runsPerIntention: 2 },
        { now: fakeClock() },
      ),
    )
    expect(runs.length).toBe(6)
    expect(runs.map((r) => r.intention)).toEqual([
      'high',
      'low',
      'baseline',
      'high',
      'low',
      'baseline',
    ])
    expect(runs.map((r) => r.run)).toEqual([0, 0, 0, 1, 1, 1])
    expect(runs.map((r) => r.sequence)).toEqual([0, 1, 2, 3, 4, 5])
    for (const run of runs) {
      expect(run.series.source).toBe('reg')
      expect(run.series.bitsPerTrial).toBe(16)
      expect(run.series.sums.length).toBe(3)
      expect(run.series.timestamps?.length).toBe(3)
    }
  })

  test('fixed schedule groups intentions in blocks', async () => {
    const runs = await collect(
      runTripolar(finiteSource('reg', 30, 7, 2), {
        trialsPerRun: 2,
        bitsPerTrial: 16,
        runsPerIntention: 2,
        order: 'fixed',
      }),
    )
    expect(runs.map((r) => r.intention)).toEqual([
      'high',
      'high',
      'low',
      'low',
      'baseline',
      'baseline',
    ])
  })

  test('is deterministic: same seed, same sums', async () => {
    const plan = { trialsPerRun: 4, bitsPerTrial: 16, runsPerIntention: 1 }
    const a = await collect(runTripolar(finiteSource('reg', 24, 42, 2), plan))
    const b = await collect(runTripolar(finiteSource('reg', 24, 42, 2), plan))
    expect(a.map((r) => [...r.series.sums])).toEqual(b.map((r) => [...r.series.sums]))
  })

  test('a source ending mid-protocol raises insufficient_data', async () => {
    // 5 chunks × 16 bits = 5 trials, but the plan needs 3 × 2 = 6
    const runs = runTripolar(finiteSource('reg', 5, 7, 2), {
      trialsPerRun: 2,
      bitsPerTrial: 16,
      runsPerIntention: 1,
    })
    await expect(collect(runs)).rejects.toMatchObject({
      name: 'PsiError',
      code: 'insufficient_data',
      source: 'reg',
    })
  })

  test('abort raises PsiError aborted', async () => {
    const controller = new AbortController()
    const runs = runTripolar(
      countingSource('reg'),
      { trialsPerRun: 2, bitsPerTrial: 200, runsPerIntention: 5 },
      { signal: controller.signal },
    )
    const first = await runs.next()
    expect(first.done).toBe(false)
    controller.abort()
    await expect(runs.next()).rejects.toMatchObject({ name: 'PsiError', code: 'aborted' })
  })

  test('runs carry arm, assignment, order, safeguard flag, and the schedule digest', async () => {
    const plan = {
      trialsPerRun: 2,
      bitsPerTrial: 16,
      runsPerIntention: 2,
      order: 'counterbalanced' as const,
    }
    const runs = await collect(runTripolar(finiteSource('reg', 30, 3, 2), plan))
    const digest = await tripolarScheduleDigest(plan)
    expect(runs.map((r) => r.intention)).toEqual([...tripolarSchedule(plan)])
    for (const run of runs) {
      expect(run.arm).toBe('experimental')
      expect(run.assignment).toBe('instructed')
      expect(run.order).toBe('counterbalanced')
      expect(run.xorSafeguard).toBe(false)
      expect(run.scheduleDigest).toBe(digest)
    }
    expect(analyzeTripolar(runs).scheduleDigest).toBe(digest)
  })

  test('instructed order follows the seeded schedule', async () => {
    const plan = {
      trialsPerRun: 1,
      bitsPerTrial: 16,
      runsPerIntention: 3,
      order: 'instructed' as const,
      seed: 99,
    }
    const runs = await collect(runTripolar(finiteSource('reg', 20, 5, 2), plan))
    expect(runs.map((r) => r.intention)).toEqual([...tripolarSchedule(plan)])
  })

  test('xorSafeguard records odd trials as k − x (0xff bytes: 16, 0, 16, …)', async () => {
    const runs = await collect(
      runTripolar(constantSource('reg', 0xff, 20), {
        trialsPerRun: 4,
        bitsPerTrial: 16,
        runsPerIntention: 1,
        xorSafeguard: true,
      }),
    )
    for (const run of runs) {
      expect([...run.series.sums]).toEqual([16, 0, 16, 0])
      expect(run.xorSafeguard).toBe(true)
    }
    // a constant bias cancels: every intention's Stouffer z is exactly 0
    const analysis = analyzeTripolar(runs)
    expect(analysis.high.z).toBe(0)
    expect(analysis.deltaZ).toBe(0)
  })

  test('control arm: one control trial per experimental trial, twin runs, contrast', async () => {
    const pulls: string[] = []
    const tracked = (name: string, value: number): TrialSource => ({
      name,
      async *stream() {
        for (let i = 0; i < 12; i++) {
          pulls.push(name)
          yield new Uint8Array(2).fill(value)
        }
      },
    })
    const runs = await collect(
      runTripolar(
        tracked('reg', 0xff),
        { trialsPerRun: 2, bitsPerTrial: 16, runsPerIntention: 1 },
        { control: tracked('csprng', 0x0f) },
      ),
    )
    expect(runs.map((r) => `${r.intention}:${r.arm}:${r.series.source}`)).toEqual([
      'high:experimental:reg',
      'high:control:csprng',
      'low:experimental:reg',
      'low:control:csprng',
      'baseline:experimental:reg',
      'baseline:control:csprng',
    ])
    expect(pulls.slice(0, 4)).toEqual(['reg', 'csprng', 'reg', 'csprng'])
    for (const run of runs.filter((r) => r.arm === 'control')) {
      expect([...run.series.sums]).toEqual([8, 8])
    }
    const experimental = analyzeTripolar(runs.filter((r) => r.arm === 'experimental'))
    const control = analyzeTripolar(runs.filter((r) => r.arm === 'control'))
    expect(controlContrast(experimental, control).z).toBe(0) // both arms constant → no separation
    await expect(
      collect(
        runTripolar(
          countingSource('same'),
          { runsPerIntention: 1 },
          { control: countingSource('same') },
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid_plan' })
  })

  test('volitional order asks the operator before each run and enforces balance', async () => {
    const seen: number[] = []
    const choices: Intention[] = ['low', 'baseline', 'high', 'high', 'low', 'baseline']
    const runs = await collect(
      runTripolar(
        finiteSource('reg', 30, 9, 2),
        { trialsPerRun: 1, bitsPerTrial: 16, runsPerIntention: 2, order: 'volitional' },
        {
          declare: ({ sequence, remaining }) => {
            seen.push(remaining.high + remaining.low + remaining.baseline)
            return choices[sequence] as Intention
          },
        },
      ),
    )
    expect(runs.map((r) => r.intention)).toEqual(choices)
    expect(runs.every((r) => r.assignment === 'volitional')).toBe(true)
    expect(seen).toEqual([6, 5, 4, 3, 2, 1])
    const plan = {
      trialsPerRun: 1,
      bitsPerTrial: 16,
      runsPerIntention: 1,
      order: 'volitional' as const,
    }
    await expect(
      collect(runTripolar(finiteSource('reg', 30, 9, 2), plan, { declare: () => 'high' })),
    ).rejects.toMatchObject({ name: 'PsiError', code: 'invalid_plan' }) // high twice
    await expect(
      // biome-ignore lint/suspicious/noExplicitAny: deliberately unknown label
      collect(runTripolar(finiteSource('reg', 30, 9, 2), plan, { declare: () => 'up' as any })),
    ).rejects.toMatchObject({ name: 'PsiError', code: 'invalid_plan' })
    await expect(collect(runTripolar(finiteSource('reg', 30, 9, 2), plan))).rejects.toMatchObject({
      code: 'invalid_plan',
    })
    await expect(
      collect(
        runTripolar(
          finiteSource('reg', 30, 9, 2),
          { runsPerIntention: 1 },
          { declare: () => 'high' },
        ),
      ),
    ).rejects.toMatchObject({ code: 'invalid_plan' })
  })

  test('a source that ends its stream on abort yields aborted, not insufficient_data', async () => {
    const controller = new AbortController()
    const polite: TrialSource = {
      name: 'polite',
      async *stream(opts) {
        while (!opts?.signal?.aborted) {
          yield new Uint8Array(25).fill(0x0f)
          await Bun.sleep(1)
        }
      },
    }
    const runs = runTripolar(
      polite,
      { trialsPerRun: 2, bitsPerTrial: 200, runsPerIntention: 50 },
      { signal: controller.signal },
    )
    expect((await runs.next()).done).toBe(false)
    controller.abort()
    await expect(collect(runs)).rejects.toMatchObject({ name: 'PsiError', code: 'aborted' })
  })

  test('abort pre-empts a source that ignores the signal, and the stream is released', async () => {
    const controller = new AbortController()
    let closed = false
    const stubborn: TrialSource = {
      name: 'stubborn',
      async *stream() {
        try {
          for (;;) {
            yield new Uint8Array(25).fill(0x0f)
            await Bun.sleep(400)
          }
        } finally {
          closed = true
        }
      },
    }
    const runs = runTripolar(
      stubborn,
      { trialsPerRun: 1, bitsPerTrial: 200, runsPerIntention: 5 },
      { signal: controller.signal },
    )
    expect((await runs.next()).done).toBe(false)
    const started = performance.now()
    setTimeout(() => controller.abort(), 10)
    await expect(runs.next()).rejects.toMatchObject({ name: 'PsiError', code: 'aborted' })
    expect(performance.now() - started).toBeLessThan(300)
    await Bun.sleep(450)
    expect(closed).toBe(true)
  })

  test('breaking out of the loop closes the source stream', async () => {
    let closed = false
    const source: TrialSource = {
      name: 'reg',
      async *stream() {
        try {
          for (;;) yield new Uint8Array(2).fill(0x0f)
        } finally {
          closed = true
        }
      },
    }
    for await (const run of runTripolar(source, {
      trialsPerRun: 1,
      bitsPerTrial: 16,
      runsPerIntention: 3,
    })) {
      expect(run.sequence).toBe(0)
      break
    }
    expect(closed).toBe(true)
  })

  test('invalid plans are rejected before any I/O', async () => {
    const source = countingSource('reg')
    const bad = [
      { trialsPerRun: 0, bitsPerTrial: 200, runsPerIntention: 1 },
      { trialsPerRun: 1.5, bitsPerTrial: 200, runsPerIntention: 1 },
      { trialsPerRun: 1, bitsPerTrial: 4, runsPerIntention: 1 },
      { trialsPerRun: 1, bitsPerTrial: 200, runsPerIntention: 0 },
      { trialsPerRun: 1, bitsPerTrial: 200, runsPerIntention: 1, order: 'random' },
    ]
    for (const plan of bad) {
      // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed plans
      await expect(collect(runTripolar(source, plan as any))).rejects.toMatchObject({
        name: 'PsiError',
        code: 'invalid_plan',
      })
    }
    expect(source.streamCalls).toBe(0)
  })
})

describe('analyzeTripolar', () => {
  // k = 100: mean 50, sd 5. high sums 55 → z = +1; low 45 → z = −1; baseline 50 → z = 0.
  const runs = [
    constantRun('high', 0, 0, 55, 10),
    constantRun('low', 0, 1, 45, 10),
    constantRun('baseline', 0, 2, 50, 10),
    constantRun('high', 1, 3, 55, 10),
    constantRun('low', 1, 4, 45, 10),
    constantRun('baseline', 1, 5, 50, 10),
  ]

  test('recovers an injected mean shift: delta z and per-bit effect size', () => {
    const analysis = analyzeTripolar(runs)
    // 20 trials of z = 1 → Stouffer z = 20/√20 = √20; ε = z/√(20·100) = 0.1 = 2(0.55 − 0.5)
    expect(analysis.high.trials).toBe(20)
    expect(analysis.high.bits).toBe(2000)
    expect(analysis.high.meanZ).toBeCloseTo(1, 12)
    expect(analysis.high.z).toBeCloseTo(Math.sqrt(20), 12)
    expect(analysis.high.effectSize).toBeCloseTo(0.1, 12)
    expect(analysis.low.effectSize).toBeCloseTo(-0.1, 12)
    expect(analysis.baseline?.z).toBeCloseTo(0, 12)
    // ΔZ = (ε_H − ε_L)/√(1/N_H + 1/N_L) = 0.2/√(0.001) = (z_H − z_L)/√2 for this balanced design
    expect(analysis.deltaEffect).toBeCloseTo(0.2, 12)
    expect(analysis.deltaZ).toBeCloseTo(0.2 / Math.sqrt(2 / 2000), 12)
    expect(analysis.deltaZ).toBeCloseTo((analysis.high.z - analysis.low.z) / Math.sqrt(2), 12)
    expect(analysis.deltaP).toBeLessThan(1e-9) // 6.32 sigma, one-sided
  })

  test('CIs use the normal approximation with z(0.975)', () => {
    const analysis = analyzeTripolar(runs)
    const half = normPpf(0.975) / Math.sqrt(2000)
    expect(analysis.high.ci95[0]).toBeCloseTo(0.1 - half, 12)
    expect(analysis.high.ci95[1]).toBeCloseTo(0.1 + half, 12)
    const deltaHalf = normPpf(0.975) * Math.sqrt(2 / 2000)
    expect(analysis.deltaCi95[0]).toBeCloseTo(0.2 - deltaHalf, 12)
    expect(analysis.deltaCi95[1]).toBeCloseTo(0.2 + deltaHalf, 12)
  })

  test('per-intention tails: high upper, low lower, baseline two-sided', () => {
    const analysis = analyzeTripolar(runs)
    expect(analysis.high.pValue).toBeLessThan(0.001) // z = +√20 in the intended direction
    expect(analysis.low.pValue).toBeLessThan(0.001) // z = −√20 in the intended direction
    expect(analysis.baseline?.pValue).toBeCloseTo(1, 12) // z = 0, two-sided
  })

  test('matches negentropy primitives exactly (composition regression gate)', () => {
    const analysis = analyzeTripolar(runs)
    const cal = theoreticalCalibration('reg', 100)
    const pooled: number[] = []
    for (const run of runs.filter((r) => r.intention === 'high')) {
      pooled.push(...zScores(run.series, cal))
    }
    expect(analysis.high.z).toBe(stoufferZ(pooled))
  })

  test('rejects mixed sources, mixed bitsPerTrial, and missing intentions', () => {
    expect(() =>
      analyzeTripolar([runs[0] as TripolarRun, constantRun('low', 0, 1, 45, 10, 100, 'other')]),
    ).toThrow(
      expect.objectContaining({ name: 'PsiError', code: 'source_mismatch' }) as unknown as Error,
    )
    expect(() =>
      analyzeTripolar([runs[0] as TripolarRun, constantRun('low', 0, 1, 45, 10, 64)]),
    ).toThrow(
      expect.objectContaining({ name: 'PsiError', code: 'source_mismatch' }) as unknown as Error,
    )
    expect(() => analyzeTripolar([runs[0] as TripolarRun])).toThrow(
      expect.objectContaining({ name: 'PsiError', code: 'insufficient_data' }) as unknown as Error,
    )
    expect(() => analyzeTripolar([])).toThrow(
      expect.objectContaining({ name: 'PsiError', code: 'insufficient_data' }) as unknown as Error,
    )
  })

  test('null data stays null: unbiased runs give |deltaZ| in a plausible range', async () => {
    const live = await collect(
      runTripolar(finiteSource('reg', 60, 1234, 25), {
        trialsPerRun: 10,
        bitsPerTrial: 200,
        runsPerIntention: 2,
      }),
    )
    const analysis = analyzeTripolar(live)
    expect(Math.abs(analysis.deltaZ)).toBeLessThan(4)
    expect(analysis.deltaP).toBeGreaterThan(1e-4)
  })
})
