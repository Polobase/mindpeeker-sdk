import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NegentropyError } from '../../src/errors.js'
import { aptCutoff, ContinuousHealth, rctCutoff } from '../../src/extract/health.js'
import { prngBytes } from '../helpers/byte-sources.js'

interface HealthFixtures {
  apt: Array<{ h: number; windowSize: number; cutoff: number }>
}

const fixtures = JSON.parse(
  readFileSync(join(import.meta.dir, '..', 'fixtures', 'health.json'), 'utf8'),
) as HealthFixtures

describe('cutoffs', () => {
  test('RCT: 1 + ⌈20/H⌉', () => {
    expect(rctCutoff(1)).toBe(21)
    expect(rctCutoff(8)).toBe(4)
    expect(rctCutoff(0.5)).toBe(41)
  })

  test('APT matches the exact scipy binomial quantile grid', () => {
    for (const { h, windowSize, cutoff } of fixtures.apt) {
      expect(aptCutoff(h, windowSize)).toBe(cutoff)
    }
  })
})

describe('ContinuousHealth (observational)', () => {
  test('healthy data raises no alarms', () => {
    const health = new ContinuousHealth({ minEntropyPerSample: 7 }, 'prng')
    expect(health.push(prngBytes(100_000, 0xdd))).toEqual([])
    expect(health.alarms.length).toBe(0)
    expect(health.samplesSeen).toBe(100_000)
  })

  test('a stuck source alarms repeatedly but keeps running', () => {
    const health = new ContinuousHealth({ minEntropyPerSample: 1 })
    const raised = health.push(new Uint8Array(4096).fill(0x42))
    // RCT cutoff 21, run resets after each alarm → roughly one alarm per 20 samples
    const rct = raised.filter((a) => a.test === 'rct')
    expect(rct.length).toBeGreaterThan(100)
    expect(rct[0]).toMatchObject({ test: 'rct', count: 21, cutoff: 21 })
    expect(health.alarms.length).toBe(raised.length)
  })

  test('APT trips on a dominant value that never runs', () => {
    // pattern v v v v x: run length 4 < 21, but v fills ~80% of every window
    const health = new ContinuousHealth({ minEntropyPerSample: 1 })
    const data = new Uint8Array(4096)
    for (let i = 0; i < data.length; i++) data[i] = i % 5 === 4 ? (i % 251) + 1 : 0
    const raised = health.push(data)
    const apt = raised.filter((a) => a.test === 'apt')
    expect(apt.length).toBeGreaterThan(0)
    expect(apt[0]?.cutoff).toBe(aptCutoff(1, 512))
    expect(raised.filter((a) => a.test === 'rct').length).toBe(0)
  })

  test('alarm carries the tripping sample index', () => {
    const health = new ContinuousHealth({ minEntropyPerSample: 1 })
    const clean = prngBytes(1000, 0xee)
    health.push(clean)
    const [alarm] = health.push(new Uint8Array(21).fill(7))
    expect(alarm?.test).toBe('rct')
    expect(alarm?.sample).toBeGreaterThanOrEqual(1000)
    expect(alarm?.sample).toBeLessThan(1021)
  })
})

describe('ContinuousHealth (strict)', () => {
  test('throws health_test on the first alarm, with source attribution', () => {
    const health = new ContinuousHealth({ minEntropyPerSample: 1, strict: true }, 'esp32')
    try {
      health.push(new Uint8Array(100).fill(1))
      expect.unreachable()
    } catch (error) {
      const err = error as NegentropyError
      expect(err.code).toBe('health_test')
      expect(err.source).toBe('esp32')
    }
  })
})

describe('validation', () => {
  test('rejects non-positive min-entropy', () => {
    expect(() => new ContinuousHealth({ minEntropyPerSample: 0 })).toThrow(NegentropyError)
  })
})
