import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { bonferroni, brownCompositeZ, compositeZ } from '../../src/experiment/composite.js'
import type { EventResult } from '../../src/experiment/types.js'
import { normSf } from '../../src/internal/special.js'
import { gaussians } from '../helpers/byte-sources.js'

function eventWithZ(id: string, z: number): EventResult {
  return {
    id,
    statistic: 'netvar',
    status: 'complete',
    value: 0,
    df: 1,
    pValue: 0,
    z,
    steps: 1,
    cumulative: new Float64Array(0),
    sources: ['s'],
  }
}

describe('compositeZ', () => {
  test('two z=1.645 events → Z ≈ 2.326, p ≈ 0.0100 (the classic Stouffer KAT)', () => {
    const z05 = 1.6448536269514722
    const composite = compositeZ([eventWithZ('a', z05), eventWithZ('b', z05)])
    expect(composite.z).toBeCloseTo(z05 * Math.SQRT2, 12)
    expect(composite.pValue).toBeCloseTo(0.01, 3)
    expect(composite.pValue).toBe(normSf(composite.z))
    expect(composite.events).toBe(2)
    expect(composite).toMatchObject({ independent: true, method: 'stouffer', variance: 2 })
  })

  test('null events give ~N(0,1) composites over replications', () => {
    const reps = 200
    const perRep = 10
    const zs = gaussians(reps * perRep, 0xcafe)
    const composites: number[] = []
    for (let rep = 0; rep < reps; rep++) {
      const events = Array.from({ length: perRep }, (_, i) =>
        eventWithZ(`e${i}`, zs[rep * perRep + i] as number),
      )
      composites.push(compositeZ(events).z)
    }
    const mean = composites.reduce((a, b) => a + b, 0) / reps
    const variance = composites.reduce((a, b) => a + (b - mean) ** 2, 0) / (reps - 1)
    expect(Math.abs(mean)).toBeLessThan(4 / Math.sqrt(reps))
    expect(Math.abs(variance - 1)).toBeLessThan(4 * Math.sqrt(2 / reps))
  })

  test('rejects empty input and incomplete events', () => {
    expect(() => compositeZ([])).toThrow(NegentropyError)
    const incomplete = { ...eventWithZ('late', Number.NaN), status: 'incomplete' as const }
    expect(() => compositeZ([eventWithZ('a', 1), incomplete])).toThrow(/incomplete/)
  })
})

describe('brownCompositeZ', () => {
  test('Σz/√(Σᵢⱼ Rᵢⱼ): identity matrix reproduces Stouffer, full correlation reproduces one event', () => {
    const events = [eventWithZ('a', 1.2), eventWithZ('b', 2.1), eventWithZ('c', -0.3)]
    const identity = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]
    const brown = brownCompositeZ(events, identity)
    expect(brown.z).toBeCloseTo(compositeZ(events).z, 14)
    expect(brown).toMatchObject({ independent: false, method: 'brown', variance: 3, events: 3 })
    const same = [eventWithZ('x', 1.7), eventWithZ('y', 1.7)]
    const one = brownCompositeZ(same, [
      [1, 1],
      [1, 1],
    ])
    expect(one.z).toBeCloseTo(1.7, 14) // identical statistics carry no extra evidence
    const half = brownCompositeZ(same, [
      [1, 0.5],
      [0.5, 1],
    ])
    expect(half.z).toBeCloseTo(3.4 / Math.sqrt(3), 14)
    expect(half.pValue).toBe(normSf(half.z))
  })

  test('restores the null: correlated z pairs (ρ = 0.6) give a unit-variance composite', () => {
    const reps = 4000
    const rho = 0.6
    const g = gaussians(2 * reps, 0xb20)
    const naive: number[] = []
    const corrected: number[] = []
    for (let rep = 0; rep < reps; rep++) {
      const x = g[2 * rep] as number
      const y = rho * x + Math.sqrt(1 - rho * rho) * (g[2 * rep + 1] as number)
      const events = [eventWithZ('a', x), eventWithZ('b', y)]
      naive.push(compositeZ(events).z)
      corrected.push(
        brownCompositeZ(events, [
          [1, rho],
          [rho, 1],
        ]).z,
      )
    }
    const variance = (v: number[]) => {
      const mean = v.reduce((a, b) => a + b, 0) / v.length
      return v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1)
    }
    const se = Math.sqrt(2 / reps)
    expect(Math.abs(variance(naive) - (1 + rho))).toBeLessThan(4 * se * (1 + rho))
    expect(Math.abs(variance(corrected) - 1)).toBeLessThan(4 * se)
  })

  test('validates the correlation matrix', () => {
    const events = [eventWithZ('a', 1), eventWithZ('b', 2)]
    for (const bad of [
      [[1, 0.2]],
      [
        [1, 0.2],
        [0.3, 1],
      ],
      [
        [0.9, 0],
        [0, 1],
      ],
      [
        [1, 1.5],
        [1.5, 1],
      ],
      [
        [1, -1],
        [-1, 1],
      ],
    ]) {
      expect(() => brownCompositeZ(events, bad)).toThrow(NegentropyError)
    }
  })
})

describe('bonferroni', () => {
  test('divides alpha by the event count', () => {
    expect(bonferroni(0.05, 10)).toBeCloseTo(0.005, 15)
    expect(() => bonferroni(0, 5)).toThrow(NegentropyError)
    expect(() => bonferroni(0.05, 0)).toThrow(NegentropyError)
  })
})
