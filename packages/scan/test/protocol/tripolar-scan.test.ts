import { describe, expect, test } from 'bun:test'
import { registerTripolar, type TripolarPlan, tripolarSchedule } from '@mindpeeker/psi'
import { defineCatalog } from '../../src/catalog.js'
import { ScanError } from '../../src/errors.js'
import { scanTripolar } from '../../src/protocol/tripolar-scan.js'
import type { Catalog, CatalogItem } from '../../src/types.js'
import { batchSource, cyclingSource, prngBytes, trackedSource } from '../helpers/byte-sources.js'

function catalog(n: number): Catalog {
  const items: CatalogItem[] = Array.from({ length: n }, (_, i) => ({
    id: `i${i}`,
    name: `item-${i}`,
  }))
  return defineCatalog('t', 'Tripolar catalog', items)
}

const PLAN: TripolarPlan = {
  trialsPerRun: 8,
  bitsPerTrial: 8,
  runsPerIntention: 2,
  order: 'interleaved',
}

/**
 * Bytes for a biased tripolar protocol (8-bit trials, one byte each): run `s`
 * of `schedule` is all 0xff for high, 0x00 for low, 0x0f for baseline.
 */
function biasBytes(
  plan: Required<Pick<TripolarPlan, 'trialsPerRun' | 'runsPerIntention'>> & TripolarPlan,
  tail: number,
) {
  const schedule = tripolarSchedule(plan)
  const out = new Uint8Array(schedule.length * plan.trialsPerRun + tail).fill(0x0f)
  schedule.forEach((intention, s) => {
    const byte = intention === 'high' ? 0xff : intention === 'low' ? 0x00 : 0x0f
    out.fill(byte, s * plan.trialsPerRun, (s + 1) * plan.trialsPerRun)
  })
  return out
}

describe('scanTripolar', () => {
  test('recovers an injected high-minus-low bias (deltaZ far from 0)', async () => {
    const plan = {
      ...PLAN,
      order: 'counterbalanced' as const,
      trialsPerRun: 8,
      runsPerIntention: 2,
    }
    const biased = batchSource('esp32', biasBytes(plan, 64))
    const report = await scanTripolar(catalog(4), biased, plan, { rounds: 16 })
    expect(report.deltaZ).toBeGreaterThan(5)
    expect(report.analysis.deltaP).toBeLessThan(1e-6)
    expect(report.deltaEffect).toBeGreaterThan(0)
    expect(report.deltaZ).toBe(report.analysis.deltaZ)
    expect(report.order).toBe('counterbalanced')
    expect(report.schedule).toEqual(tripolarSchedule(plan))
  })

  test('null data stays null: |deltaZ| in a plausible range', async () => {
    const fair = cyclingSource('esp32', prngBytes(4096, 20250708))
    const report = await scanTripolar(catalog(4), fair, PLAN, { rounds: 16 })
    expect(Math.abs(report.deltaZ)).toBeLessThan(4)
    expect(report.analysis.deltaP).toBeGreaterThan(1e-4)
  })

  test('one stream for both phases: a replayable source is opened once and closed', async () => {
    const M = 4
    const rounds = 16
    const { source, log } = trackedSource('esp32', prngBytes(4096, 3), { chunkBytes: 7 })
    const report = await scanTripolar(catalog(M), source, PLAN, { rounds })
    expect(log.opened).toBe(1)
    expect(log.closed).toBe(1)
    const protocolBytes = 3 * PLAN.runsPerIntention * (PLAN.trialsPerRun as number)
    const scoringBits = 3 * rounds * M
    expect(report.phaseAccounting.protocol).toEqual({
      bytesConsumed: protocolBytes,
      bitsUsed: protocolBytes * 8,
    })
    expect(report.phaseAccounting.scoring).toEqual({
      bytesConsumed: scoringBits / 8,
      bitsUsed: scoringBits,
    })
    expect(report.accounting).toEqual({
      bytesConsumed: protocolBytes + scoringBits / 8,
      bitsUsed: protocolBytes * 8 + scoringBits,
    })
  })

  test('phase 2 never re-reads phase-1 bytes (a finite source is exhausted exactly)', async () => {
    const M = 2
    const rounds = 8
    const protocolBytes = 3 * PLAN.runsPerIntention * (PLAN.trialsPerRun as number)
    const exact = prngBytes(protocolBytes + (3 * rounds * M) / 8, 9)
    const report = await scanTripolar(catalog(M), batchSource('b', exact, 5), PLAN, { rounds })
    expect(report.accounting.bytesConsumed).toBe(exact.length)
    const short = exact.subarray(0, exact.length - 1)
    await expect(
      scanTripolar(catalog(M), batchSource('b', short, 5), PLAN, { rounds }),
    ).rejects.toMatchObject({
      code: 'insufficient_entropy',
    })
  })

  test('non-byte trial sizes consume exactly ceil(bits/8) protocol bytes', async () => {
    const plan: TripolarPlan = {
      trialsPerRun: 3,
      bitsPerTrial: 12,
      runsPerIntention: 1,
      order: 'fixed',
    }
    const report = await scanTripolar(catalog(2), cyclingSource('u', prngBytes(512, 4)), plan, {
      rounds: 4,
    })
    expect(report.phaseAccounting.protocol).toEqual({
      bytesConsumed: Math.ceil((9 * 12) / 8),
      bitsUsed: 9 * 12,
    })
  })

  test('catalog scoring follows the protocol schedule, not fixed blocks', async () => {
    // 1 item, 2 runs per intention, 8 rounds per intention → six blocks of 4 coins.
    // The protocol takes 48 bytes; the coins are the next 3 bytes, MSB-first:
    // 0xff 0x00 0xf0 → blocks [1111][1111][0000][0000][1111][0000].
    const structured = new Uint8Array(512).fill(0x0f)
    structured.set([0xff, 0x00, 0xf0], 48)
    const run = (order: 'fixed' | 'interleaved') =>
      scanTripolar(catalog(1), batchSource('s', structured), { ...PLAN, order }, { rounds: 8 })
    const successes = (r: Awaited<ReturnType<typeof run>>) =>
      (['high', 'low', 'baseline'] as const).map((i) => r.perIntention[i][0]?.deviation?.successes)
    // fixed H H L L B B → high 4+4, low 0+0, baseline 4+0
    expect(successes(await run('fixed'))).toEqual([8, 0, 4])
    // interleaved H L B H L B → high 4+0, low 4+4, baseline 0+0
    expect(successes(await run('interleaved'))).toEqual([4, 8, 0])
  })

  test('uneven rounds per run: every intention still gets exactly `rounds` rounds', async () => {
    const report = await scanTripolar(catalog(2), cyclingSource('u', prngBytes(1024, 8)), PLAN, {
      rounds: 7,
    })
    for (const intention of ['high', 'low', 'baseline'] as const) {
      for (const r of report.perIntention[intention]) expect(r.deviation?.rounds).toBe(7)
    }
    expect(report.phaseAccounting.scoring.bitsUsed).toBe(3 * 7 * 2)
  })

  test('scores the catalog under each intention with 3M-family multiplicity', async () => {
    const M = 4
    const report = await scanTripolar(catalog(M), cyclingSource('u', prngBytes(4096, 3)), PLAN, {
      rounds: 16,
      alpha: 0.1,
      prior: { a: 8, b: 8 },
    })
    expect(report.multiplicity.tests).toBe(3 * M)
    expect(report.multiplicity.expectedFalsePositives).toBeCloseTo(1.2, 12)
    for (const intention of ['high', 'low', 'baseline'] as const) {
      const scores = report.perIntention[intention]
      expect(scores.length).toBe(M)
      expect(scores[0]?.rank).toBe(1)
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i - 1]?.deviation?.lnBayesFactor ?? 0).toBeGreaterThanOrEqual(
          scores[i]?.deviation?.lnBayesFactor ?? 0,
        )
      }
    }
  })

  test('per-intention rank 1 does not depend on catalog order', async () => {
    const ids = ['alpha', 'bravo', 'charlie', 'delta']
    const cat = (order: readonly string[]) =>
      defineCatalog(
        't',
        'Tripolar catalog',
        order.map((id) => ({ id, name: id })),
      )
    const zeros = () => cyclingSource('even', new Uint8Array(4096))
    const a = await scanTripolar(cat(ids), zeros(), PLAN, { rounds: 16 })
    const b = await scanTripolar(cat([...ids].reverse()), zeros(), PLAN, { rounds: 16 })
    for (const intention of ['high', 'low', 'baseline'] as const) {
      expect(a.perIntention[intention].map((r) => r.id)).toEqual(
        b.perIntention[intention].map((r) => r.id),
      )
    }
  })

  test('control arm: a yoked control source is analysed and contrasted', async () => {
    const { source: control, log } = trackedSource('csprng-control', prngBytes(4096, 77))
    const report = await scanTripolar(
      catalog(3),
      cyclingSource('esp32', prngBytes(4096, 5)),
      PLAN,
      {
        rounds: 8,
        control,
      },
    )
    expect(report.control?.source).toBe('csprng-control')
    expect(report.control?.analysis.source).toBe('csprng-control')
    expect(Number.isFinite(report.control?.contrast.z)).toBe(true)
    expect(report.control?.accounting.bytesConsumed).toBe(48)
    expect(log.opened).toBe(1)
    expect(log.closed).toBe(1)
    await expect(
      scanTripolar(catalog(3), cyclingSource('same', prngBytes(64, 1)), PLAN, {
        control: cyclingSource('same', prngBytes(64, 2)),
      }),
    ).rejects.toMatchObject({ code: 'invalid_options' })
  })

  test('registration: a matching plan passes and reports its hash; a divergent one is rejected', async () => {
    const registration = await registerTripolar(PLAN)
    const ok = await scanTripolar(catalog(2), cyclingSource('u', prngBytes(2048, 1)), PLAN, {
      rounds: 8,
      registration,
    })
    expect(ok.registration).toBe(registration.hash)
    const other = await registerTripolar({ ...PLAN, runsPerIntention: 3 })
    await expect(
      scanTripolar(catalog(2), cyclingSource('u', prngBytes(2048, 1)), PLAN, {
        rounds: 8,
        registration: other,
      }),
    ).rejects.toMatchObject({ name: 'ScanError', code: 'invalid_options' })
  })

  test('instructed and volitional orders pass through to psi', async () => {
    const instructed = await scanTripolar(
      catalog(2),
      cyclingSource('u', prngBytes(2048, 1)),
      { ...PLAN, order: 'instructed', seed: 42 },
      { rounds: 4 },
    )
    expect(instructed.schedule).toEqual(
      tripolarSchedule({ ...PLAN, order: 'instructed', seed: 42 }),
    )
    const declared = ['low', 'high', 'baseline', 'baseline', 'high', 'low'] as const
    const volitional = await scanTripolar(
      catalog(2),
      cyclingSource('u', prngBytes(2048, 1)),
      { ...PLAN, order: 'volitional' },
      { rounds: 4, declare: ({ sequence }) => declared[sequence] as 'high' },
    )
    expect(volitional.schedule).toEqual([...declared])
  })

  test('rejects an empty catalog and malformed options or plans', async () => {
    const empty = { id: 'x', name: 'x', items: [] } as Catalog
    await expect(
      scanTripolar(empty, cyclingSource('u', prngBytes(64, 1)), PLAN),
    ).rejects.toBeInstanceOf(ScanError)
    for (const opts of [{ rounds: 0 }, { rounds: 1.5 }, { prior: { a: 0 } }, { alpha: 2 }]) {
      await expect(
        scanTripolar(catalog(2), cyclingSource('u', prngBytes(64, 1)), PLAN, opts),
      ).rejects.toMatchObject({ code: 'invalid_options' })
    }
    await expect(
      scanTripolar(catalog(2), cyclingSource('u', prngBytes(64, 1)), { runsPerIntention: 0 }),
    ).rejects.toMatchObject({ code: 'invalid_options' })
  })

  test('abort raises ScanError aborted and closes the stream', async () => {
    const ac = new AbortController()
    const { source, log } = trackedSource('slow', prngBytes(4096, 1), { chunkBytes: 4, delayMs: 2 })
    const run = scanTripolar(catalog(4), source, PLAN, { rounds: 16, signal: ac.signal })
    setTimeout(() => ac.abort(), 10)
    await expect(run).rejects.toMatchObject({ name: 'ScanError', code: 'aborted' })
    await Bun.sleep(20)
    expect(log.closed).toBe(log.opened)
  })
})
