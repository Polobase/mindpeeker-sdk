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

describe('APT exact boundary', () => {
  test('cutoff − 1 occurrences in a window stay silent; the cutoff-th alarms', () => {
    // H = 8, W = 512 → APT cutoff 13, RCT cutoff 4 (no runs of the reference here)
    const health = new ContinuousHealth({ minEntropyPerSample: 8 })
    expect(health.aptCutoff).toBe(13)
    const window = new Uint8Array(40)
    for (let i = 0; i < window.length; i++) window[i] = i % 2 === 0 ? 7 : 100 + i
    // indices 0, 2, …, 22 → 12 occurrences of the reference value 7
    expect(health.push(window.subarray(0, 24))).toEqual([])
    const [alarm] = health.push(window.subarray(24, 25)) // 13th occurrence
    expect(alarm).toMatchObject({ test: 'apt', count: 13, cutoff: 13, sample: 24 })
  })
})

describe('validation', () => {
  const invalid = expect.objectContaining({ name: 'NegentropyError', code: 'invalid_config' })

  test('rejects min-entropy outside (0, 8] bits per byte', () => {
    expect(() => new ContinuousHealth({ minEntropyPerSample: 0 })).toThrow(NegentropyError)
    for (const bad of [0, -1, 8.01, 100, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new ContinuousHealth({ minEntropyPerSample: bad })).toThrow(invalid)
    }
    expect(new ContinuousHealth({ minEntropyPerSample: 8 }).rctCutoff).toBe(4)
  })

  test('rejects window sizes other than 512 and 1024', () => {
    const windowSize = 100 as 512
    expect(() => new ContinuousHealth({ minEntropyPerSample: 1, windowSize })).toThrow(invalid)
  })

  test('very low H keeps the exact cutoffs: APT inactive (W + 1) below 20/W, RCT still armed', () => {
    const health = new ContinuousHealth({ minEntropyPerSample: 0.01 })
    expect(health.aptCutoff).toBe(513)
    expect(health.rctCutoff).toBe(2001)
    const jitter = new ContinuousHealth({ minEntropyPerSample: 0.0625, windowSize: 1024 })
    expect(jitter.aptCutoff).toBe(1009)
  })
})
