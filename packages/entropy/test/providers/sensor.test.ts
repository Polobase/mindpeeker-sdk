import { afterEach, describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import {
  browserSensorSource,
  type SensorSource,
  sensorEntropy,
  sensorReadingBytes,
} from '../../src/providers/sensor.js'
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

  test('validates frequency, warmupSamples and queueLimit at construction', () => {
    const source = jitterySource()
    const bad: Record<string, unknown>[] = [
      { frequency: 0 },
      { frequency: Number.POSITIVE_INFINITY },
      { warmupSamples: -1 },
      { warmupSamples: 1.5 },
      { queueLimit: 0 },
    ]
    for (const opts of bad) expect(() => sensorEntropy({ source, ...opts })).toThrow(EntropyError)
  })

  test('without a source and without browser sensors, fails with a remedy', async () => {
    const err = await sensorEntropy()
      .getBytes(4)
      .catch((e) => e)
    expect(err).toBeInstanceOf(EntropyError)
    expect((err as EntropyError).code).toBe('invalid_request')
    expect((err as Error).message).toContain('source')
  })
})

describe('browserSensorSource (fake browser globals)', () => {
  const g = globalThis as Record<string, unknown>
  afterEach(() => {
    delete g.Accelerometer
    delete g.Gyroscope
    delete g.DeviceMotionEvent
  })

  class FakeSensor {
    static instances: FakeSensor[] = []
    x: number | null = null
    y: number | null = null
    z: number | null = null
    stopped = false
    #listener: (() => void) | null = null
    constructor() {
      FakeSensor.instances.push(this)
    }
    addEventListener(_type: string, listener: () => void) {
      this.#listener = listener
    }
    start() {}
    stop() {
      this.stopped = true
    }
    fire(x: number, y: number, z: number) {
      this.x = x
      this.y = y
      this.z = z
      this.#listener?.()
    }
  }

  test('Generic Sensor: each event pushes only the three axes of the sensor that fired', async () => {
    FakeSensor.instances = []
    g.Accelerometer = class extends FakeSensor {}
    g.Gyroscope = class extends FakeSensor {}
    const iterator = browserSensorSource(60).samples()[Symbol.asyncIterator]()
    const first = iterator.next()
    await new Promise((r) => setTimeout(r, 5))
    const [accel, gyro] = FakeSensor.instances as [FakeSensor, FakeSensor]
    accel.fire(1, 2, 3)
    expect((await first).value).toEqual([1, 2, 3])
    gyro.fire(4, 5, 6)
    expect((await iterator.next()).value).toEqual([4, 5, 6]) // not [1,2,3,4,5,6]
    await iterator.return?.(undefined)
    expect(accel.stopped && gyro.stopped).toBe(true)
  })

  test('Generic Sensor: a slow consumer keeps only the newest readings', async () => {
    FakeSensor.instances = []
    g.Accelerometer = class extends FakeSensor {}
    const iterator = browserSensorSource(60, 2).samples()[Symbol.asyncIterator]()
    const first = iterator.next()
    await new Promise((r) => setTimeout(r, 5))
    const [accel] = FakeSensor.instances as [FakeSensor]
    accel.fire(0, 0, 0)
    await first
    for (let i = 1; i <= 5; i++) accel.fire(i, i, i)
    expect((await iterator.next()).value).toEqual([4, 4, 4])
    expect((await iterator.next()).value).toEqual([5, 5, 5])
    await iterator.return?.(undefined)
  })

  test("DeviceMotion: an iOS permission answer other than 'granted' throws permission", async () => {
    g.DeviceMotionEvent = { requestPermission: async () => 'denied' }
    const err = (await sensorEntropy()
      .getBytes(4, { timeoutMs: 5000 })
      .catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('permission')
    expect(err.message).toContain('denied')
  })

  test('DeviceMotion: a rejected permission request throws permission', async () => {
    g.DeviceMotionEvent = {
      requestPermission: async () => {
        throw new DOMException('needs a user gesture', 'NotAllowedError')
      },
    }
    const err = (await sensorEntropy()
      .getBytes(4, { timeoutMs: 5000 })
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('permission')
  })
})
