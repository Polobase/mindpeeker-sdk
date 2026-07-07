/**
 * Entropy QUALITY measurement of raw sources + noise bitmaps.
 *
 *   bun scripts/quality.ts
 *
 * Statistical tests can only FAIL a source — whitened output (cloud
 * providers, anything conditioned) passes everything by construction. The
 * interesting subjects are the RAW local sources, where we can check how
 * much entropy the physics really delivers vs. what the library credits.
 *
 * Writes docs/noise/<source>.png bitmaps (256×256 of raw bytes — human eyes
 * are excellent pattern detectors) and prints a markdown report.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ffmpegFrameSource } from '../src/node/ffmpeg-frames.js'
import { nodeSerialSource } from '../src/node/serial-source.js'
import { cameraEntropy } from '../src/providers/camera.js'
import { cryptoProvider } from '../src/providers/crypto.js'
import { jitterEntropy } from '../src/providers/jitter.js'
import { qrandomIo } from '../src/providers/qrandom.js'
import { serialEntropy } from '../src/providers/serial.js'
import type { EntropyProvider } from '../src/types.js'
import { loadNearestDotEnv } from '../test/helpers/dotenv.js'
import { grayPng } from './png.js'
import {
  chiSquare,
  compressionRatio,
  markovMinEntropyPerBit,
  mcvMinEntropy,
  monobit,
  monteCarloPi,
  runsTest,
  serialCorrelation,
  shannonEntropy,
  toBits,
} from './stats.js'

loadNearestDotEnv(import.meta.dir)
const env = (name: string) => process.env[name] ?? ''
const NOISE_DIR = join(import.meta.dir, '../docs/noise')
mkdirSync(NOISE_DIR, { recursive: true })

interface Subject {
  name: string
  raw: boolean
  creditedH: string
  bytes: number
  note: string
  make: () => Promise<EntropyProvider> | EntropyProvider
  cleanup?: () => void
}

const subjects: Subject[] = []

subjects.push({
  name: 'crypto',
  raw: false,
  creditedH: '—',
  bytes: 1_048_576,
  note: 'CSPRNG baseline (whitened by design)',
  make: () => cryptoProvider(),
})

subjects.push({
  name: 'jitter-raw',
  raw: true,
  creditedH: '0.0625 b/B',
  bytes: 524_288,
  note: 'raw hrtime deltas & 0xff',
  make: () => jitterEntropy({ conditioning: 'raw' }),
})

const serialPath = env('ENTROPY_SERIAL_PATH') || '/dev/cu.usbserial-110'
if (existsSync(serialPath)) {
  let source: Awaited<ReturnType<typeof nodeSerialSource>> | null = null
  subjects.push({
    name: 'esp32-raw',
    raw: true,
    creditedH: '7 b/B',
    bytes: 1_048_576,
    note: 'esp_fill_random over serial, unprocessed',
    make: async () => {
      source = await nodeSerialSource({ path: serialPath })
      return serialEntropy({ source, name: 'esp32', conditioning: 'raw' })
    },
    cleanup: () => source?.close(),
  })
}

const ffmpegDevice = env('ENTROPY_FFMPEG_DEVICE')
if (ffmpegDevice !== '') {
  subjects.push({
    name: 'camera-raw',
    raw: true,
    creditedH: '1 b/B',
    bytes: 65_536,
    note: 'frame-diff sign bits after von Neumann',
    make: () =>
      cameraEntropy({
        source: ffmpegFrameSource({ device: ffmpegDevice, width: 640, height: 480 }),
        warmupFrames: 30,
        conditioning: 'raw',
      }),
  })
}

subjects.push({
  name: 'qrandom.io',
  raw: false,
  creditedH: '—',
  bytes: 4096,
  note: 'whitened cloud QRNG (small quota-polite sample)',
  make: () => qrandomIo(),
})

interface Result {
  subject: Subject
  n: number
  shannon: number
  mcv: number
  markov: number
  chi: { statistic: number; pValue: number }
  scc: number
  mono: { onesFraction: number; z: number }
  runsZ: number
  pi: number
  gzip: number
}

const results: Result[] = []

for (const subject of subjects) {
  process.stdout.write(`${subject.name}: collecting ${subject.bytes} bytes… `)
  try {
    const provider = await subject.make()
    const start = performance.now()
    const { bytes } = await provider.getBytes(subject.bytes, { timeoutMs: 300_000 })
    console.log(`${((performance.now() - start) / 1000).toFixed(1)} s`)
    const bits = toBits(bytes)
    results.push({
      subject,
      n: bytes.length,
      shannon: shannonEntropy(bytes),
      mcv: mcvMinEntropy(bytes),
      markov: markovMinEntropyPerBit(bits),
      chi: chiSquare(bytes),
      scc: serialCorrelation(bytes),
      mono: monobit(bits),
      runsZ: runsTest(bits),
      pi: monteCarloPi(bytes),
      gzip: compressionRatio(bytes),
    })
    const side = Math.min(256, Math.floor(Math.sqrt(bytes.length)))
    writeFileSync(join(NOISE_DIR, `${subject.name}.png`), grayPng(side, side, bytes))
  } catch (error) {
    console.log(`skipped (${(error as { code?: string }).code ?? (error as Error).message})`)
  } finally {
    subject.cleanup?.()
  }
}

console.log(
  '\n| Source | Sample | Shannon (b/B) | 90B MCV (b/B) | 90B Markov (b/bit) | χ² p | Serial corr | Ones | Runs z | MC π | gzip |',
)
console.log('|---|---|---|---|---|---|---|---|---|---|---|')
for (const r of results.sort((a, b) => b.mcv - a.mcv)) {
  console.log(
    `| ${r.subject.name} | ${(r.n / 1024).toFixed(0)} KiB | ${r.shannon.toFixed(3)} | ${r.mcv.toFixed(2)} | ${r.markov.toFixed(3)} | ${r.chi.pValue.toFixed(3)} | ${r.scc.toFixed(4)} | ${(r.mono.onesFraction * 100).toFixed(2)}% | ${r.runsZ.toFixed(1)} | ${r.pi.toFixed(3)} | ${r.gzip.toFixed(3)} |`,
  )
}
console.log('\ncredited H per source:')
for (const r of results) {
  if (r.subject.raw)
    console.log(
      `- ${r.subject.name}: credited ${r.subject.creditedH}, measured MCV ${r.mcv.toFixed(2)} b/B (${r.subject.note})`,
    )
}
console.log(`\nbitmaps: ${NOISE_DIR}/<source>.png`)
console.log(
  `platform: ${process.platform} ${process.arch}, bun ${Bun.version}, ${new Date().toISOString().slice(0, 10)}`,
)
process.exit(0)
