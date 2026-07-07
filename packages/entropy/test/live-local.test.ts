/**
 * Live tests against LOCAL hardware. Skipped unless LIVE=1:
 *
 *   LIVE=1 bun test live-local
 *
 * ESP32 (AetherOnePi firmware, raw 921600-baud stream): needs the device at
 * ENTROPY_SERIAL_PATH (default /dev/cu.usbserial-110). Camera: needs ffmpeg
 * on PATH and ENTROPY_FFMPEG_DEVICE (e.g. "0" for the built-in macOS camera).
 */
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { ffmpegFrameSource } from '../src/node/ffmpeg-frames.js'
import { nodeSerialSource } from '../src/node/serial-source.js'
import { cameraEntropy } from '../src/providers/camera.js'
import { serialEntropy } from '../src/providers/serial.js'
import { loadNearestDotEnv } from './helpers/dotenv.js'

loadNearestDotEnv(import.meta.dir)

const LIVE = process.env.LIVE === '1'
const SERIAL_PATH = process.env.ENTROPY_SERIAL_PATH || '/dev/cu.usbserial-110'
const HAS_ESP32 = existsSync(SERIAL_PATH)
const FFMPEG_DEVICE = process.env.ENTROPY_FFMPEG_DEVICE ?? ''

describe('live: ESP32 over serial', () => {
  test.skipIf(!LIVE || !HAS_ESP32)(
    'raw mode passes health tests and yields device bytes',
    async () => {
      const source = await nodeSerialSource({ path: SERIAL_PATH })
      try {
        const esp32 = serialEntropy({ source, name: 'esp32', conditioning: 'raw' })
        const { bytes, sources } = await esp32.getBytes(64, { timeoutMs: 10_000 })
        expect(bytes.length).toBe(64)
        expect(sources[0]?.name).toBe('esp32(raw)')
        // esp_fill_random output is near-uniform — a healthy read is diverse
        expect(new Set(bytes).size).toBeGreaterThan(30)
      } finally {
        source.close()
      }
    },
    20_000,
  )

  test.skipIf(!LIVE || !HAS_ESP32)(
    'conditioned mode produces whitened output quickly',
    async () => {
      const source = await nodeSerialSource({ path: SERIAL_PATH })
      try {
        const esp32 = serialEntropy({ source, name: 'esp32' })
        const start = Date.now()
        const { bytes, sources } = await esp32.getBytes(64, { timeoutMs: 10_000 })
        expect(bytes.length).toBe(64)
        expect(sources[0]?.name).toBe('esp32')
        expect(Date.now() - start).toBeLessThan(5000)
      } finally {
        source.close()
      }
    },
    20_000,
  )

  test.skipIf(!LIVE || !HAS_ESP32)(
    'streams chunks and tears the session down on break',
    async () => {
      const source = await nodeSerialSource({ path: SERIAL_PATH })
      try {
        const esp32 = serialEntropy({ source, name: 'esp32' })
        const chunks: Uint8Array[] = []
        for await (const chunk of esp32.stream({ chunkBytes: 32 })) {
          chunks.push(chunk)
          if (chunks.length === 3) break
        }
        expect(chunks).toHaveLength(3)
        expect(chunks.every((c) => c.length === 32)).toBe(true)
        expect(new Set([...(chunks[0] as Uint8Array)]).size).toBeGreaterThan(10)
      } finally {
        source.close()
      }
    },
    20_000,
  )
})

describe('live: camera via ffmpeg', () => {
  test.skipIf(!LIVE || FFMPEG_DEVICE === '')(
    'harvests conditioned bytes from real camera noise',
    async () => {
      const camera = cameraEntropy({
        source: ffmpegFrameSource({ device: FFMPEG_DEVICE, width: 320, height: 240 }),
        warmupFrames: 30, // let auto-exposure settle (~1 s at 30 fps)
      })
      const { bytes, sources } = await camera.getBytes(32, { timeoutMs: 30_000 })
      expect(bytes.length).toBe(32)
      expect(sources[0]?.name).toBe('camera')
      expect(new Set(bytes).size).toBeGreaterThan(10)
    },
    40_000,
  )
})
