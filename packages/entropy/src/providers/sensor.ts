import { packBits } from '../internal/bits.js'
import type { ConditioningOptions } from '../internal/condition.js'
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
  /** Generic Sensor API frequency hint. Default 60. */
  frequency?: number
  /** Readings discarded at session start. Default 30. */
  warmupSamples?: number
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
  x?: number
  y?: number
  z?: number
}

type GenericSensorCtor = new (options?: { frequency?: number }) => GenericSensorLike

function browserSensorSource(frequency: number): SensorSource {
  return {
    async *samples(signal?: AbortSignal) {
      const g = globalThis as {
        Accelerometer?: GenericSensorCtor
        Gyroscope?: GenericSensorCtor
        DeviceMotionEvent?: { requestPermission?: () => Promise<string> }
        addEventListener?: typeof addEventListener
        removeEventListener?: typeof removeEventListener
      }

      const queue: number[][] = []
      let notify: (() => void) | null = null
      const push = (reading: number[]) => {
        queue.push(reading)
        notify?.()
      }

      let cleanup: () => void
      if (g.Accelerometer) {
        // Generic Sensor API (Chromium): readings are quantized to 0.1 m/s² /
        // 0.1 °/s — the conservative credit accounts for that.
        const sensors: GenericSensorLike[] = [new g.Accelerometer({ frequency })]
        if (g.Gyroscope) sensors.push(new g.Gyroscope({ frequency }))
        for (const sensor of sensors) {
          sensor.addEventListener('reading', () => {
            push(sensors.flatMap((s) => [s.x ?? 0, s.y ?? 0, s.z ?? 0]))
          })
          sensor.start()
        }
        cleanup = () => {
          for (const sensor of sensors) sensor.stop()
        }
      } else if (typeof g.addEventListener === 'function' && 'DeviceMotionEvent' in g) {
        // iOS requires an explicit permission request from a user gesture.
        await g.DeviceMotionEvent?.requestPermission?.()
        const onMotion = (event: DeviceMotionEvent) => {
          const a = event.accelerationIncludingGravity
          const r = event.rotationRate
          push([a?.x ?? 0, a?.y ?? 0, a?.z ?? 0, r?.alpha ?? 0, r?.beta ?? 0, r?.gamma ?? 0])
        }
        g.addEventListener('devicemotion', onMotion as EventListener)
        cleanup = () => g.removeEventListener?.('devicemotion', onMotion as EventListener)
      } else {
        throw new TypeError('sensorEntropy: no motion sensors in this runtime — pass a { source }')
      }

      try {
        while (true) {
          if (signal?.aborted) throw signal.reason
          const reading = queue.shift()
          if (reading) {
            yield reading
          } else {
            await new Promise<void>((resolve) => {
              notify = resolve
            })
            notify = null
          }
        }
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
 */
export function sensorEntropy(opts: SensorOptions = {}): EntropyProvider {
  const { frequency = 60, warmupSamples = 30 } = opts
  const source = opts.source ?? browserSensorSource(frequency)

  async function* open(signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    let skipped = 0
    let leftover: number[] = []
    for await (const reading of source.samples(signal)) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('aborted', 'AbortError')
      if (skipped < warmupSamples) {
        skipped++
        continue
      }
      const bytes = sensorReadingBytes(reading)
      const bits: number[] = leftover
      for (const byte of bytes) {
        for (let b = 7; b >= 0; b--) bits.push((byte >> b) & 1)
      }
      const [packed, rest] = packBits(bits)
      leftover = rest
      if (packed.length > 0) yield packed
    }
  }

  return sampledProvider(
    {
      name: 'sensor',
      kind: 'trng',
      privacy: 'private',
      open,
      // ≤1 bit per quantized reading (≈6 raw bytes) → 0.25 b/B is already generous
      defaultMinEntropyPerSample: 0.25,
      // …but health-test at H=1 so a frozen device's repeating pattern trips
      // the APT instead of sliding under a disabled cutoff
      defaultHealthMinEntropyPerSample: 1,
      defaultSafetyFactor: 4,
      defaultTimeoutMs: 60_000, // permission prompt + slow accumulation
    },
    opts,
  )
}
