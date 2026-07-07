import { type ByteSource, iterateBytes, persistentBytes } from '../internal/byte-source.js'
import type { ConditioningOptions } from '../internal/condition.js'
import { sampledProvider } from '../internal/sampled.js'
import type { EntropyProvider } from '../types.js'

/** The Web Serial SerialPort surface this provider needs (injectable). */
export interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  readable: ReadableStream<Uint8Array> | null
  writable?: WritableStream<Uint8Array> | null
}

export interface SerialOptions extends ConditioningOptions {
  /** Web Serial port (navigator.serial.requestPort()); opened/closed per session. */
  port?: SerialPortLike
  /** Pre-opened byte stream: Node serialport instance, nodeSerialSource, tests. */
  source?: ByteSource
  /** Default 921_600 — the AetherOnePi ESP32 firmware rate. Only used with `port`. */
  baudRate?: number
  /** Bytes discarded at session start (stale OS buffers). Default 256. */
  warmupBytes?: number
  /** Written once after open — device-init quirk hook (e.g. OneRNG). Needs `port`. */
  init?: Uint8Array
  /** Attribution label, e.g. 'esp32' or 'truerng'. Default 'serial'. */
  name?: string
}

/**
 * Hardware TRNG behind a serial byte stream: an ESP32 running the AetherOnePi
 * firmware (raw 921600-baud stream of esp_fill_random bytes), a TrueRNG v3,
 * a OneRNG (pass its init command via `init`), or any injected ByteSource.
 * Device bytes are the raw samples — `conditioning: 'raw'` is a health-tested
 * passthrough of exactly what the hardware emitted.
 */
export function serialEntropy(opts: SerialOptions): EntropyProvider {
  const { port, source, baudRate = 921_600, warmupBytes = 256, init, name = 'serial' } = opts
  if ((port === undefined) === (source === undefined)) {
    throw new TypeError('serialEntropy requires exactly one of { port } or { source }')
  }
  if (init && !port) {
    throw new TypeError('serialEntropy: init commands need a { port } (a raw source has no writer)')
  }

  async function* skipWarmup(bytes: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
    let skipped = 0
    for await (const chunk of bytes) {
      if (skipped < warmupBytes) {
        const need = warmupBytes - skipped
        if (chunk.length <= need) {
          skipped += chunk.length
          continue
        }
        skipped = warmupBytes
        yield chunk.slice(need)
      } else {
        yield chunk
      }
    }
  }

  // Injected sources are persistent: sessions read from one shared iterator,
  // warmup is applied once for the source's lifetime, and closing a session
  // never closes the source (its owner does). Ports reopen per session.
  const sharedSource = source
    ? persistentBytes(
        (async function* warmed() {
          yield* skipWarmup(iterateBytes(source))
        })(),
      )
    : null

  async function* open(signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    if (port) {
      await port.open({ baudRate })
      try {
        if (init && port.writable) {
          const writer = port.writable.getWriter()
          try {
            await writer.write(init)
          } finally {
            writer.releaseLock()
          }
        }
        if (!port.readable) {
          throw new TypeError('serialEntropy: port has no readable stream after open()')
        }
        yield* skipWarmup(iterateBytes(port.readable, signal))
      } finally {
        await port.close().catch(() => {})
      }
    } else {
      yield* (sharedSource as NonNullable<typeof sharedSource>)(signal)
    }
  }

  return sampledProvider(
    {
      name,
      kind: 'trng',
      privacy: 'private',
      open,
      defaultMinEntropyPerSample: 7,
      defaultSafetyFactor: 2,
    },
    opts,
  )
}
