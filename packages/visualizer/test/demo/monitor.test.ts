import { describe, expect, test } from 'bun:test'
import {
  anytimeP,
  cumulativeDeviation,
  netvarBoundary,
  netvarLogM,
  netvarMartingale,
  significanceEnvelope,
  trialsFromBytes,
  villeCrossing,
} from '@mindpeeker/negentropy'
import {
  ANYTIME_ALPHA,
  ANYTIME_PRIOR,
  anytimeNote,
  BAND_LABELS,
  cumdevSample,
  type MonitorPoint,
  NetvarMonitor,
  netvarSample,
} from '../../src/demo/monitor.js'
import { liveMonitorPoints } from '../../src/demo.js'
import { VisualizerError } from '../../src/errors.js'
import { prngBytes } from '../helpers/streams.js'

const T = 1000
const bytes = prngBytes(25 * T, 0x5eed) // exactly 1000 trials of 200 bits
const { sums } = trialsFromBytes(bytes, 'recorded', { bitsPerTrial: 200 })
const zs = Array.from(sums, (s) => (s - 100) / Math.sqrt(50))

function run(values: readonly number[], bitsPerStep = 200): MonitorPoint[] {
  const monitor = new NetvarMonitor(bitsPerStep)
  return values.map((z) => monitor.add(z))
}

describe('NetvarMonitor', () => {
  const points = run(zs)

  test('D(t) is bit-identical to the batch cumulativeDeviation', () => {
    const batch = cumulativeDeviation(zs)
    expect(points).toHaveLength(T)
    points.forEach((point, i) => {
      expect(point.t).toBe(i + 1)
      expect(point.deviation).toBe(batch[i] as number)
    })
  })

  test('the pointwise band is bit-identical to significanceEnvelope at every step', () => {
    const upper = significanceEnvelope(T, 0.05)
    const lower = significanceEnvelope(T, 0.95)
    points.forEach((point, i) => {
      expect(point.pointwise[1]).toBe(upper[i] as number)
      expect(point.pointwise[0]).toBe(lower[i] as number)
    })
    // independent closed forms at df 1 and 2: χ²₀.₉₅(1) = Φ⁻¹(0.975)², χ²_q(2) = −2 ln(1 − q)
    expect(points[0]?.pointwise[1]).toBeCloseTo(1.959963984540054 ** 2 - 1, 12)
    expect(points[1]?.pointwise[1]).toBeCloseTo(-2 * Math.log(0.05) - 2, 12)
    expect(points[1]?.pointwise[0]).toBeCloseTo(-2 * Math.log(0.95) - 2, 12)
  })

  test('the anytime boundary and ln M are netvarBoundary / netvarLogM with the upper Gamma(1, 1) prior', () => {
    expect(ANYTIME_PRIOR).toEqual({ a: 1, b: 1, sided: 'upper' })
    const batch = cumulativeDeviation(zs)
    points.forEach((point, i) => {
      const t = i + 1
      expect(point.anytime).toEqual(netvarBoundary(t, ANYTIME_ALPHA, ANYTIME_PRIOR))
      expect(point.anytime.lower).toBe(Number.NEGATIVE_INFINITY)
      expect(point.logM).toBe(netvarLogM(t, batch[i] as number, ANYTIME_PRIOR))
    })
    // the martingale path agrees with negentropy's batch form (point form ≈ stream form)
    const path = netvarMartingale(zs, ANYTIME_PRIOR)
    points.forEach((point, i) => {
      expect(Math.abs(point.logM - (path[i] as number))).toBeLessThan(1e-9)
    })
  })

  test('the running anytime p is anytimeP over the ln M path', () => {
    const expected = anytimeP(points.map((point) => point.logM))
    points.forEach((point, i) => {
      expect(point.anytimeP).toBe(expected[i] as number)
    })
    for (let i = 1; i < T; i++) {
      expect((points[i] as MonitorPoint).anytimeP).toBeLessThanOrEqual(
        (points[i - 1] as MonitorPoint).anytimeP,
      )
    }
  })

  test('netvar Z = D/√(v t) with v = 2 − 2/200, checked against exact integer sums', () => {
    let squares = 0
    points.forEach((point, i) => {
      const t = i + 1
      squares += ((sums[i] as number) - 100) ** 2
      // D(t) = (Σ(S − 100)² − 50 t) / 50 exactly, v = 1.99
      const reference = (squares - 50 * t) / 50 / Math.sqrt(1.99 * t)
      expect(Math.abs(point.netvarZ - reference)).toBeLessThan(
        1e-12 * Math.max(1, Math.abs(reference)),
      )
    })
    // more bits per step shrink the lattice correction: v = 2 − 2/800 = 1.9975
    const [wide] = run([2], 800)
    expect(wide?.netvarZ).toBeCloseTo(3 / Math.sqrt(1.9975), 15)
  })

  test('crossing the anytime boundary is exactly ln M ≥ ln(1/α), i.e. anytime p ≤ α', () => {
    // a variance excess: |Z| = 2.5 every step, D grows by 5.25 per step
    const excess = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 2.5 : -2.5))
    const path = run(excess)
    const crossed = path.findIndex((point) => point.deviation >= point.anytime.upper)
    expect(crossed).toBeGreaterThan(0)
    expect(crossed).toBe(
      villeCrossing(
        path.map((point) => point.logM),
        ANYTIME_ALPHA,
      ),
    )
    expect(path.findIndex((point) => point.anytimeP <= ANYTIME_ALPHA)).toBe(crossed)
    // the pointwise band is left long before the time-uniform boundary
    const pointwiseExit = path.findIndex((point) => point.deviation > point.pointwise[1])
    expect(pointwiseExit).toBeLessThan(crossed)
    expect(anytimeNote(path[crossed] as MonitorPoint)).toContain('≤ α = 0.05')
  })

  test('rejects a non-finite Z and an invalid bit count', () => {
    const monitor = new NetvarMonitor(200)
    for (const z of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => monitor.add(z)).toThrow(VisualizerError)
    }
    expect(monitor.steps).toBe(0)
    for (const bits of [0, 7, 200.5, Number.NaN]) {
      expect(() => new NetvarMonitor(bits)).toThrow(VisualizerError)
    }
  })
})

describe('samples and caption', () => {
  const [first] = run([0.3])
  const point = first as MonitorPoint

  test('cumdev carries the labeled pointwise band and the one-sided anytime boundary', () => {
    expect(cumdevSample(point)).toEqual({
      t: 1,
      value: point.deviation,
      bands: [
        { lo: point.pointwise[0], hi: point.pointwise[1], label: 'two-sided 90% pointwise' },
        {
          lo: Number.NEGATIVE_INFINITY,
          hi: point.anytime.upper,
          label: 'anytime-valid (α = 0.05)',
        },
      ],
    })
    expect(BAND_LABELS).toEqual({
      pointwise: 'two-sided 90% pointwise',
      anytime: 'anytime-valid (α = 0.05)',
    })
  })

  test('netvar Z carries ±Φ⁻¹(0.95) as its pointwise band', () => {
    const sample = netvarSample(point)
    if (typeof sample === 'number' || !sample.bands) throw new Error('expected bands')
    // scipy.stats.norm.ppf(0.95) = 1.6448536269514722
    expect(sample.bands[0]?.hi).toBeCloseTo(1.6448536269514722, 14)
    expect(sample.bands[0]?.lo).toBe(-(sample.bands[0]?.hi as number))
    expect(sample.value).toBe(point.netvarZ)
  })

  test('anytimeNote formats two decimals, then exponent notation', () => {
    const at = (p: number) => anytimeNote({ ...point, anytimeP: p })
    expect(at(1)).toBe('anytime p = 1.00')
    expect(at(0.4137)).toBe('anytime p = 0.41')
    expect(at(0.05)).toBe('anytime p = 0.05 ≤ α = 0.05')
    expect(at(0.00123)).toBe('anytime p = 1.2e-3 ≤ α = 0.05')
  })
})

describe('liveMonitorPoints', () => {
  test('trials → hash-chained lines → Stouffer Z reproduces the direct computation exactly', async () => {
    const source = {
      name: 'recorded',
      async *stream() {
        for (let at = 0; at < bytes.length; at += 256) yield bytes.subarray(at, at + 256)
      },
    }
    const live: MonitorPoint[] = []
    for await (const point of liveMonitorPoints(source, { now: () => 0 })) live.push(point)
    const direct = run(zs)
    expect(live).toHaveLength(T)
    live.forEach((point, i) => {
      expect(point).toEqual(direct[i] as MonitorPoint)
    })
  })
})
