/**
 * Sustained stream() throughput — steady-state rates measured AFTER the
 * first chunk (excludes session setup, permissions and warmup), unlike the
 * single-call latencies in bench.ts.
 *
 *   bun scripts/stream-bench.ts
 */
import { existsSync } from 'node:fs'
import { ffmpegFrameSource } from '../src/node/ffmpeg-frames.js'
import { nodeSerialSource } from '../src/node/serial-source.js'
import { cameraEntropy } from '../src/providers/camera.js'
import { drand } from '../src/providers/drand.js'
import { jitterEntropy } from '../src/providers/jitter.js'
import { serialEntropy } from '../src/providers/serial.js'
import { superRand } from '../src/providers/superrand.js'
import type { EntropyProvider } from '../src/types.js'
import { loadNearestDotEnv } from '../test/helpers/dotenv.js'

loadNearestDotEnv(import.meta.dir)
const env = (name: string) => process.env[name] ?? ''

interface Row {
  name: string
  chunkBytes: number
  seconds: number
  bytes: number
  chunks: number
  note: string
}

const rows: Row[] = []

async function benchStream(
  name: string,
  windowMs: number,
  chunkBytes: number,
  note: string,
  make: () => Promise<EntropyProvider> | EntropyProvider,
  cleanup?: () => void,
): Promise<void> {
  process.stdout.write(`${name}… `)
  try {
    const provider = await make()
    let bytes = 0
    let chunks = 0
    let start = 0
    for await (const chunk of provider.stream({ chunkBytes })) {
      if (chunks === 0) {
        start = performance.now() // steady state: clock from the first chunk
      } else {
        bytes += chunk.length
      }
      chunks++
      if (start > 0 && performance.now() - start >= windowMs) break
    }
    const seconds = (performance.now() - start) / 1000
    rows.push({ name, chunkBytes, seconds, bytes, chunks: chunks - 1, note })
    console.log(`${(bytes / 1024 / seconds).toFixed(1)} KiB/s over ${seconds.toFixed(1)} s`)
  } catch (error) {
    rows.push({
      name,
      chunkBytes,
      seconds: 0,
      bytes: 0,
      chunks: 0,
      note: `skipped: ${(error as { code?: string }).code ?? (error as Error).message}`,
    })
    console.log('skipped')
  } finally {
    cleanup?.()
  }
}

await benchStream('jitter (conditioned)', 5_000, 32, 'hrtime deltas', () => jitterEntropy())

const serialPath = env('ENTROPY_SERIAL_PATH') || '/dev/cu.usbserial-110'
if (existsSync(serialPath)) {
  {
    const source = await nodeSerialSource({ path: serialPath })
    await benchStream(
      'esp32 (raw)',
      8_000,
      4096,
      'AetherOnePi firmware passthrough',
      () => serialEntropy({ source, name: 'esp32', conditioning: 'raw' }),
      () => source.close(),
    )
  }
  {
    const source = await nodeSerialSource({ path: serialPath })
    await benchStream(
      'esp32 (conditioned)',
      8_000,
      32,
      'SHA-256, 2× credit',
      () => serialEntropy({ source, name: 'esp32' }),
      () => source.close(),
    )
  }
}

const ffmpegDevice = env('ENTROPY_FFMPEG_DEVICE')
if (ffmpegDevice !== '') {
  await benchStream(
    'camera (conditioned)',
    20_000,
    32,
    'sign bits, VN, 8× credit — steady state',
    () =>
      cameraEntropy({
        source: ffmpegFrameSource({ device: ffmpegDevice, width: 640, height: 480 }),
        warmupFrames: 30,
      }),
  )
}

await benchStream('drand (beacon)', 10_000, 32, 'one 32 B round / 3 s, PUBLIC', () => drand())

if (env('SUPERRAND_API_KEY')) {
  await benchStream('superrand (WebSocket)', 8_000, 32, 'live WS, one request in flight', () =>
    superRand({ apiKey: env('SUPERRAND_API_KEY') }),
  )
}

console.log('\n| Source | Chunk | Window | Steady-state rate | Notes |')
console.log('|---|---|---|---|---|')
for (const row of rows.sort(
  (a, b) => (b.seconds ? b.bytes / b.seconds : -1) - (a.seconds ? a.bytes / a.seconds : -1),
)) {
  const rate =
    row.seconds > 0
      ? `${(row.bytes / 1024 / row.seconds).toFixed(2)} KiB/s (${row.chunks} chunks)`
      : '—'
  console.log(
    `| ${row.name} | ${row.chunkBytes} B | ${row.seconds.toFixed(1)} s | ${rate} | ${row.note} |`,
  )
}
console.log(
  `\nplatform: ${process.platform} ${process.arch}, bun ${Bun.version}, ${new Date().toISOString().slice(0, 10)}`,
)
process.exit(0)
