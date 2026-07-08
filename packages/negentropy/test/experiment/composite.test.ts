import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { bonferroni, compositeZ } from '../../src/experiment/composite.js'
import type { EventResult } from '../../src/experiment/types.js'
import { normSf } from '../../src/internal/special.js'
import { gaussians } from '../helpers/byte-sources.js'

function eventWithZ(id: string, z: number): EventResult {
  return {
    id,
    statistic: 'netvar',
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

  test('rejects empty input', () => {
    expect(() => compositeZ([])).toThrow(NegentropyError)
  })
})

describe('bonferroni', () => {
  test('divides alpha by the event count', () => {
    expect(bonferroni(0.05, 10)).toBeCloseTo(0.005, 15)
    expect(() => bonferroni(0, 5)).toThrow(NegentropyError)
    expect(() => bonferroni(0.05, 0)).toThrow(NegentropyError)
  })
})
