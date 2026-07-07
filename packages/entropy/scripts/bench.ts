/**
 * Provider benchmark — measures real latency/throughput on THIS machine
 * against live services and connected hardware. Respects free-tier quotas
 * (tiny requests for metered cloud APIs). Run from packages/entropy:
 *
 *   bun scripts/bench.ts
 *
 * Uses keys from the workspace .env (see .env.example); providers without
 * keys/hardware are reported as skipped.
 */
import { existsSync } from 'node:fs'
import { ffmpegFrameSource } from '../src/node/ffmpeg-frames.js'
import { nodeSerialSource } from '../src/node/serial-source.js'
import { anu } from '../src/providers/anu.js'
import { anuLegacy } from '../src/providers/anu-legacy.js'
import { cameraEntropy } from '../src/providers/camera.js'
import { cryptoProvider } from '../src/providers/crypto.js'
import { drand } from '../src/providers/drand.js'
import { jitterEntropy } from '../src/providers/jitter.js'
import { lfdr } from '../src/providers/lfdr.js'
import { nistBeacon } from '../src/providers/nist-beacon.js'
import { outshift } from '../src/providers/outshift.js'
import { qci } from '../src/providers/qci.js'
import { qrandomIo } from '../src/providers/qrandom.js'
import { randomOrg } from '../src/providers/random-org.js'
import { serialEntropy } from '../src/providers/serial.js'
import { superRand } from '../src/providers/superrand.js'
import type { EntropyProvider } from '../src/types.js'
import { loadNearestDotEnv } from '../test/helpers/dotenv.js'

loadNearestDotEnv(import.meta.dir)
const env = (name: string) => process.env[name] ?? ''

interface Row {
  name: string
  kind: string
  transport: string
  bytes: number
  ms: number | null
  note: string
}

const rows: Row[] = []

async function bench(
  name: string,
  kind: string,
  transport: string,
  bytes: number,
  note: string,
  make: () => Promise<EntropyProvider> | EntropyProvider,
  cleanup?: () => void,
): Promise<void> {
  process.stdout.write(`${name} (${bytes} B)… `)
  try {
    const provider = await make()
    const start = performance.now()
    const result = await provider.getBytes(bytes, { timeoutMs: 60_000 })
    const ms = performance.now() - start
    if (result.bytes.length !== bytes) throw new Error('short read')
    rows.push({ name, kind, transport, bytes, ms, note })
    console.log(`${ms.toFixed(0)} ms`)
  } catch (error) {
    const reason =
      (error as { code?: string }).code ?? (error as Error).constructor?.name ?? 'error'
    rows.push({ name, kind, transport, bytes, ms: null, note: `failed/skipped: ${reason}` })
    console.log(`skipped (${reason})`)
  } finally {
    cleanup?.()
  }
}

function skip(name: string, kind: string, transport: string, note: string): void {
  rows.push({ name, kind, transport, bytes: 0, ms: null, note })
  console.log(`${name}: ${note}`)
}

// ---------- local ----------

await bench('crypto', 'csprng', 'in-process', 1_048_576, 'runtime CSPRNG baseline', () =>
  cryptoProvider(),
)

await bench('jitter', 'trng', 'in-process', 1024, 'hrtime deltas, conditioned', () =>
  jitterEntropy(),
)

const serialPath = env('ENTROPY_SERIAL_PATH') || '/dev/cu.usbserial-110'
if (existsSync(serialPath)) {
  {
    const source = await nodeSerialSource({ path: serialPath })
    await bench(
      'esp32 (raw)',
      'trng',
      'usb serial 921600',
      16_384,
      'AetherOnePi firmware, raw passthrough',
      () => serialEntropyWith(source, 'raw'),
      () => source.close(),
    )
  }
  {
    const source = await nodeSerialSource({ path: serialPath })
    await bench(
      'esp32 (conditioned)',
      'trng',
      'usb serial 921600',
      2048,
      'SHA-256 conditioned, 2× credit',
      () => serialEntropyWith(source, 'conditioned'),
      () => source.close(),
    )
  }
} else {
  skip('esp32', 'trng', 'usb serial', `no device at ${serialPath}`)
}

function serialEntropyWith(
  source: Awaited<ReturnType<typeof nodeSerialSource>>,
  conditioning: 'raw' | 'conditioned',
) {
  return serialEntropy({ source, name: 'esp32', conditioning })
}

const ffmpegDevice = env('ENTROPY_FFMPEG_DEVICE')
if (ffmpegDevice !== '') {
  await bench(
    'camera (conditioned)',
    'trng',
    'ffmpeg avfoundation',
    64,
    'frame-diff sign bits, VN debias, 8× credit',
    () =>
      cameraEntropy({
        source: ffmpegFrameSource({ device: ffmpegDevice, width: 320, height: 240 }),
        warmupFrames: 30,
      }),
  )
  await bench(
    'camera (raw)',
    'trng',
    'ffmpeg avfoundation',
    1024,
    'unwhitened sign bits after VN',
    () =>
      cameraEntropy({
        source: ffmpegFrameSource({ device: ffmpegDevice, width: 320, height: 240 }),
        warmupFrames: 30,
        conditioning: 'raw',
      }),
  )
} else {
  skip('camera', 'trng', 'ffmpeg', 'set ENTROPY_FFMPEG_DEVICE')
}

// ---------- cloud (tiny requests — daily quotas) ----------

await bench('qrandom.io', 'qrng', 'https', 64, 'free, keyless', () => qrandomIo())
await bench('lfdr.de', 'qrng', 'https', 64, 'free, keyless', () => lfdr())
await bench('drand quicknet', 'beacon', 'https', 64, 'PUBLIC randomness, 2 rounds', () => drand())
await bench('nist-beacon', 'beacon', 'https', 64, 'PUBLIC randomness, 1 pulse', () => nistBeacon())

if (env('ANU_API_KEY')) {
  await bench('anu (keyed)', 'qrng', 'https', 64, 'quantum vacuum', () =>
    anu({ apiKey: env('ANU_API_KEY') }),
  )
} else skip('anu (keyed)', 'qrng', 'https', 'no ANU_API_KEY')

if (env('OUTSHIFT_API_KEY')) {
  await bench('outshift', 'qrng', 'https', 64, '100k bits/day quota', () =>
    outshift({ apiKey: env('OUTSHIFT_API_KEY') }),
  )
} else skip('outshift', 'qrng', 'https', 'no OUTSHIFT_API_KEY')

if (env('RANDOM_ORG_API_KEY')) {
  await bench('random.org', 'trng', 'https json-rpc', 64, '250k bits/day quota', () =>
    randomOrg({ apiKey: env('RANDOM_ORG_API_KEY') }),
  )
} else skip('random.org', 'trng', 'https', 'no RANDOM_ORG_API_KEY')

if (env('SUPERRAND_API_KEY')) {
  await bench('superrand (REST)', 'trng', 'https', 64, '≤256 values/request', () =>
    superRand({ apiKey: env('SUPERRAND_API_KEY') }),
  )
} else skip('superrand', 'trng', 'https', 'no SUPERRAND_API_KEY')

if (env('QCI_API_TOKEN')) {
  await bench('qci', 'qrng', 'https oauth', 64, '1G bits/month', () =>
    qci({ apiToken: env('QCI_API_TOKEN') }),
  )
} else skip('qci', 'qrng', 'https', 'no QCI_API_TOKEN')

await bench('anu-legacy', 'qrng', 'https', 16, '1 request/minute limit', () => anuLegacy())

// ---------- report ----------

function rate(row: Row): number {
  return row.ms && row.ms > 0 ? row.bytes / (row.ms / 1000) : -1
}

function fmtRate(bytesPerSecond: number): string {
  if (bytesPerSecond < 0) return '—'
  if (bytesPerSecond >= 1_048_576) return `${(bytesPerSecond / 1_048_576).toFixed(1)} MiB/s`
  if (bytesPerSecond >= 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KiB/s`
  return `${bytesPerSecond.toFixed(1)} B/s`
}

rows.sort((a, b) => rate(b) - rate(a))
console.log(`\n| # | Provider | Kind | Transport | Request | Latency | Effective rate | Notes |`)
console.log('|---|---|---|---|---|---|---|---|')
rows.forEach((row, i) => {
  const latency = row.ms === null ? '—' : `${row.ms.toFixed(0)} ms`
  const request = row.bytes > 0 ? `${row.bytes} B` : '—'
  console.log(
    `| ${row.ms === null ? '—' : i + 1} | ${row.name} | ${row.kind} | ${row.transport} | ${request} | ${latency} | ${fmtRate(rate(row))} | ${row.note} |`,
  )
})
console.log(
  `\nplatform: ${process.platform} ${process.arch}, bun ${Bun.version}, ${new Date().toISOString().slice(0, 10)}`,
)
process.exit(0)
