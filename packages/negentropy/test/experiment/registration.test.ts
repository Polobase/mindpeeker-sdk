import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { canonicalJson, registerExperiment } from '../../src/experiment/registration.js'
import type { ExperimentConfig } from '../../src/experiment/types.js'
import { sha256Condition } from '../../src/extract/condition.js'

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

describe('canonicalJson', () => {
  test('sorts keys recursively and strips undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 3, y: 4 }], c: 5 }, skip: undefined })).toBe(
      '{"a":{"c":5,"d":[2,{"y":4,"z":3}]},"b":1}',
    )
  })

  test('serializes Dates as ISO strings', () => {
    expect(canonicalJson({ at: new Date('2026-07-08T12:00:00.000Z') })).toBe(
      '{"at":"2026-07-08T12:00:00.000Z"}',
    )
  })

  test('rejects non-finite numbers and functions', () => {
    expect(() => canonicalJson({ x: Number.NaN })).toThrow(NegentropyError)
    expect(() => canonicalJson({ f: () => 1 })).toThrow(NegentropyError)
  })
})

describe('registerExperiment', () => {
  const config: ExperimentConfig = {
    events: [{ id: 'e1', statistic: 'netvar', start: 0, end: 100 }],
    calibration: 'theoretical',
  }

  test('hash is the SHA-256 of the canonical JSON', async () => {
    const { hash } = await registerExperiment(config)
    const expected = hex(await sha256Condition(new TextEncoder().encode(canonicalJson(config))))
    expect(hash).toBe(expected)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('key order does not change the hash; content does', async () => {
    const reordered: ExperimentConfig = {
      calibration: 'theoretical',
      events: [{ statistic: 'netvar', end: 100, start: 0, id: 'e1' }],
    }
    expect((await registerExperiment(reordered)).hash).toBe((await registerExperiment(config)).hash)
    const different: ExperimentConfig = {
      ...config,
      events: [{ id: 'e1', statistic: 'netvar', start: 0, end: 101 }],
    }
    expect((await registerExperiment(different)).hash).not.toBe(
      (await registerExperiment(config)).hash,
    )
  })

  test('the registered config is deeply frozen', async () => {
    const { config: frozen } = await registerExperiment(config)
    expect(() => {
      ;(frozen as { missing?: string }).missing = 'skip'
    }).toThrow(TypeError)
    expect(() => {
      ;(frozen.events as unknown as { id: string }[])[0]!.id = 'tampered'
    }).toThrow(TypeError)
  })
})
