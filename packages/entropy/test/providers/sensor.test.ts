import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { type SensorSource, sensorEntropy, sensorReadingBytes } from '../../src/providers/sensor.js'
import { providerContract } from '../helpers/provider-contract.js'

/** Jittery 6-axis readings (accelerometer + gyroscope) in batches. */
function jitterySource(): SensorSource {
  let state = 0x1337c0de
  const next = () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0xffffffff
  }
  return {
    async *samples() {
      while (true) {
        yield [9.8 + next(), next() - 0.5, next() - 0.5, next(), next(), next()]
      }
    },
  }
}

describe('sensorReadingBytes', () => {
  test('scales axis values and keeps the low byte', () => {
    expect(sensorReadingBytes([9.81, 0.05, -0.13])).toEqual(
      new Uint8Array([981 & 0xff, 5, -13 & 0xff]),
    )
  })

  test('supports custom scales', () => {
    expect(sensorReadingBytes([2.5], 10)).toEqual(new Uint8Array([25]))
  })
})

providerContract(
  'sensorEntropy (scripted readings)',
  () => sensorEntropy({ source: jitterySource(), warmupSamples: 0 }),
  { kind: 'trng', privacy: 'private', lengths: [1, 16, 33] },
)

describe('sensorEntropy', () => {
  test('is named sensor; raw mode sensor(raw)', () => {
    expect(sensorEntropy({ source: jitterySource() }).name).toBe('sensor')
    expect(sensorEntropy({ source: jitterySource(), conditioning: 'raw' }).name).toBe('sensor(raw)')
  })

  test('discards warmup readings', async () => {
    let i = 0
    const source: SensorSource = {
      async *samples() {
        while (true) yield [i++ / 100] // one axis; byte value === reading index
      },
    }
    const { bytes } = await sensorEntropy({
      source,
      warmupSamples: 4,
      conditioning: 'raw',
    }).getBytes(4)
    expect(bytes).toEqual(new Uint8Array([4, 5, 6, 7]))
  })

  test('a frozen device trips the health tests', async () => {
    const source: SensorSource = {
      async *samples() {
        while (true) yield [9.8, 0, 0, 0, 0, 0]
      },
    }
    const err = (await sensorEntropy({ source, warmupSamples: 0 })
      .getBytes(8)
      .catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('health_test')
  })

  test('without a source and without browser sensors, fails with a remedy', async () => {
    const err = await sensorEntropy()
      .getBytes(4)
      .catch((e) => e)
    expect(err).toBeInstanceOf(TypeError)
    expect((err as Error).message).toContain('source')
  })
})
