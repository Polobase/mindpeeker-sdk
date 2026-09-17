import { EntropyError } from '../errors.js'
import type { ConditioningOptions } from '../internal/condition.js'
import { requireFinite, requireInteger } from '../internal/options.js'
import {
  DEFAULT_QUEUE_LIMIT,
  DropOldestQueue,
  permissionError,
  starvationGuard,
} from '../internal/queue.js'
import { sampledProvider } from '../internal/sampled.js'
import type { EntropyProvider } from '../types.js'

export interface SensorSource {
  /** One reading per motion event: available axes, e.g. [ax, ay, az, gx, gy, gz]. */
  samples(signal?: AbortSignal): AsyncIterable<Float64Array | number[]>
  close?(): void | Promise<void>
}

export interface SensorOptions extends ConditioningOptions {
  /** Injected readings (tests, non-browser runtimes). Default: browser motion sensors. */
  source?: SensorSource
  /** Generic Sensor API frequency hint in Hz (finite, > 0). Default 60. */
  frequency?: number
  /** Readings (integer ≥ 0) discarded at session start. Default 30. */
  warmupSamples?: number
  /**
   * Browser capture only: readings held while the consumer is busy
   * (integer ≥ 1); the oldest is dropped beyond it. Default 8.
   */
  queueLimit?: number
}

/** One byte per axis: scale the reading and keep the low byte. */
export function sensorReadingBytes(reading: ArrayLike<number>, scale = 100): Uint8Array {
  const out = new Uint8Array(reading.length)
  for (let i = 0; i < reading.length; i++) {
    out[i] = Math.round((reading[i] as number) * scale) & 0xff
  }
  return out
}

interface GenericSensorLike {
  start(): void
  stop(): void
  addEventListener(type: string, listener: () => void): void
  x?: number | null
  y?: number | null
  z?: number | null
}

type GenericSensorCtor = new (options?: { frequency?: number }) => GenericSensorLike

/**
 * Browser motion sensors: the Generic Sensor API (Chromium) — each event
 * pushes only the three axes of the sensor that fired — or DeviceMotion
 * (iOS asks permission; a denial throws `EntropyError('permission')`).
 * Exported for tests; `sensorEntropy()` uses it when no `source` is given.
 */
export function browserSensorSource(
  frequency: number,
  queueLimit: number = DEFAULT_QUEUE_LIMIT,
): SensorSource {
  return {
    async *samples(signal?: AbortSignal) {
      const g = globalThis as {
        Accelerometer?: GenericSensorCtor
        Gyroscope?: GenericSensorCtor
        DeviceMotionEvent?: { requestPermission?: () => Promise<string> }
        addEventListener?: typeof addEventListener
        removeEventListener?: typeof removeEventListener
      }

      const queue = new DropOldestQueue<number[]>(queueLimit, 'sensor')

      let cleanup: () => void
      if (g.Accelerometer) {
        // Generic Sensor API (Chromium): readings are quantized to 0.1 m/s² /
        // 0.1 °/s — the conservative credit accounts for that. Each event
        // carries fresh values for its own sensor only.
        const sensors: GenericSensorLike[] = [new g.Accelerometer({ frequency })]
        if (g.Gyroscope) sensors.push(new g.Gyroscope({ frequency }))
        for (const sensor of sensors) {
          sensor.addEventListener('reading', () => {
            queue.push([sensor.x ?? 0, sensor.y ?? 0, sensor.z ?? 0])
          })
          sensor.start()
        }
        cleanup = () => {
          for (const sensor of sensors) sensor.stop()
        }
      } else if (typeof g.addEventListener === 'function' && 'DeviceMotionEvent' in g) {
        // iOS requires an explicit permission request from a user gesture.
        const request = g.DeviceMotionEvent?.requestPermission
        if (typeof request === 'function') {
          let state: string
          try {
            state = await request.call(g.DeviceMotionEvent)
          } catch (error) {
            const mapped = permissionError(error, 'sensor', 'motion sensor')
            throw mapped instanceof EntropyError
              ? mapped
              : new EntropyError('permission', 'motion sensor permission request failed', {
                  provider: 'sensor',
                  cause: error,
                })
          }
          if (state !== 'granted') {
            throw new EntropyError('permission', `motion sensor permission ${state}`, {
              provider: 'sensor',
            })
          }
        }
        const onMotion = (event: DeviceMotionEvent) => {
          const a = event.accelerationIncludingGravity
          const r = event.rotationRate
          queue.push([a?.x ?? 0, a?.y ?? 0, a?.z ?? 0, r?.alpha ?? 0, r?.beta ?? 0, r?.gamma ?? 0])
        }
        g.addEventListener('devicemotion', onMotion as EventListener)
        cleanup = () => g.removeEventListener?.('devicemotion', onMotion as EventListener)
      } else {
        throw new EntropyError(
          'invalid_request',
          'sensorEntropy: no motion sensors in this runtime — pass a { source }',
          { provider: 'sensor' },
        )
      }

      try {
        while (true) yield await queue.take(signal)
      } finally {
        cleanup()
      }
    },
  }
}

/**
 * Motion-sensor noise (accelerometer/gyroscope). Browser readings are
 * privacy-quantized, so the credited entropy is deliberately tiny — this is a
 * breadth source for phones/tablets, best mixed via `xorMix`, not a fast one.
 *
 * Throws `EntropyError('invalid_request')` at construction for an invalid
 * `frequency`, `warmupSamples`, `queueLimit` or conditioning option.
 */
export function sensorEntropy(opts: SensorOptions = {}): EntropyProvider {
  const frequency = requireFinite(
    opts.frequency ?? 60,
    'frequency',
    { min: 0, minExclusive: true },
    'sensor',
  )
  const warmupSamples = requireInteger(opts.warmupSamples ?? 30, 'warmupSamples', 0, 'sensor')
  const queueLimit = requireInteger(
    opts.queueLimit ?? DEFAULT_QUEUE_LIMIT,
    'queueLimit',
    1,
    'sensor',
  )
  const source = opts.source ?? browserSensorSource(frequency, queueLimit)

  async function* open(signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    let skipped = 0
    const tick = starvationGuard(signal)
    for await (const reading of source.samples(signal)) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('aborted', 'AbortError')
      if (skipped < warmupSamples) {
        skipped++
        await tick(false)
        continue
      }
      // readings map to whole bytes (one per axis), so no bit carry is needed
      const bytes = sensorReadingBytes(reading)
      if (bytes.length > 0) yield bytes
      await tick(bytes.length > 0)
    }
  }

  return sampledProvider(
    {
      name: 'sensor',
      kind: 'trng',
      privacy: 'private',
      open,
      // 0.25 bit credited per axis byte: 0.75 bits per 3-axis Generic Sensor
      // event, 1.5 bits per 6-axis DeviceMotion event — below one bit per
      // quantized axis reading
      defaultMinEntropyPerSample: 0.25,
      // …but health-test at H=1 so a frozen device's repeating pattern trips
      // the tests with tight cutoffs
      defaultHealthMinEntropyPerSample: 1,
      defaultSafetyFactor: 4,
      defaultTimeoutMs: 60_000, // permission prompt + slow accumulation
    },
    opts,
  )
}
