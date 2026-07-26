import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NegentropyError } from '../../src/errors.js'
import { approximateEntropy, sampleEntropy } from '../../src/estimators/sample-entropy.js'
import { gaussians } from '../helpers/byte-sources.js'

interface EstimatorFixtures {
  sampleApprox: Array<{
    label: string
    samples: number[]
    m: number
    r: number
    sampleEntropy: number
    approximateEntropy: number
  }>
}
const fixtures = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'estimators.json'), 'utf8'),
) as EstimatorFixtures

describe('sampleEntropy / approximateEntropy', () => {
  test('match the Richman–Moorman cross-language reference (explicit r)', () => {
    for (const c of fixtures.sampleApprox) {
      expect(sampleEntropy(c.samples, c.m, c.r)).toBeCloseTo(c.sampleEntropy, 10)
      expect(approximateEntropy(c.samples, c.m, c.r)).toBeCloseTo(c.approximateEntropy, 10)
    }
  })

  test('a regular signal scores far below white noise', () => {
    const sine = Array.from({ length: 400 }, (_, t) => Math.sin(t / 5))
    const noise = Array.from(gaussians(400, 0xbeef))
    expect(sampleEntropy(sine)).toBeLessThan(sampleEntropy(noise))
    expect(approximateEntropy(sine)).toBeLessThan(approximateEntropy(noise))
  })

  test('default r = 0.2·sd is used when omitted', () => {
    const x = Array.from(gaussians(200, 0x11))
    const sd = Math.sqrt(
      x.reduce((a, v) => a + (v - x.reduce((s, w) => s + w, 0) / x.length) ** 2, 0) / x.length,
    )
    expect(sampleEntropy(x)).toBeCloseTo(sampleEntropy(x, 2, 0.2 * sd), 12)
  })

  test('validation', () => {
    expect(() => sampleEntropy([1, 2, 3], 2)).toThrow(NegentropyError) // n < m + 2
    expect(() => sampleEntropy(new Array(50).fill(7))).toThrow(NegentropyError) // sd 0
    expect(() => sampleEntropy(gaussians(50, 1), 0)).toThrow(NegentropyError) // m < 1
  })
})
