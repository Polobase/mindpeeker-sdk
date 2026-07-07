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
import { ffmpegSampleSource } from '../src/node/ffmpeg-samples.js'
import { nodeSerialSource } from '../src/node/serial-source.js'
import { anu } from '../src/providers/anu.js'
import { cameraEntropy } from '../src/providers/camera.js'
import { cryptoProvider } from '../src/providers/crypto.js'
import { drand } from '../src/providers/drand.js'
import { jitterEntropy } from '../src/providers/jitter.js'
import { lfdr } from '../src/providers/lfdr.js'
import { micEntropy } from '../src/providers/microphone.js'
import { nistBeacon } from '../src/providers/nist-beacon.js'
import { outshift } from '../src/providers/outshift.js'
import { qrandomIo } from '../src/providers/qrandom.js'
import { randomOrg } from '../src/providers/random-org.js'
import { serialEntropy } from '../src/providers/serial.js'
import { superRand } from '../src/providers/superrand.js'
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

const audioDevice = env('ENTROPY_FFMPEG_AUDIO') || (ffmpegDevice !== '' ? ':1' : '')
if (audioDevice !== '') {
  subjects.push({
    name: 'microphone-raw',
    raw: true,
    creditedH: '2 b/B',
    bytes: 32_768,
    note: 'sample LSBs via ffmpeg',
    make: () =>
      micEntropy({
        source: ffmpegSampleSource({ device: audioDevice }),
        conditioning: 'raw',
      }),
  })
}

// Cloud sources — all whitened (expected to pass everything; this is a
// sanity check, not a quality ranking). Sample sizes stay well inside each
// service's free-tier/day budget.
subjects.push({
  name: 'qrandom.io',
  raw: false,
  creditedH: '—',
  bytes: 32_768,
  note: 'whitened cloud QRNG, fair-use keyless',
  make: () => qrandomIo(),
})

subjects.push({
  name: 'lfdr.de',
  raw: false,
  creditedH: '—',
  bytes: 32_768,
  note: 'whitened cloud QRNG, fair-use keyless',
  make: () => lfdr(),
})

if (env('ANU_API_KEY')) {
  subjects.push({
    name: 'anu',
    raw: false,
    creditedH: '—',
    bytes: 8192,
    note: 'quantum vacuum, 8 API requests',
    make: () => anu({ apiKey: env('ANU_API_KEY') }),
  })
}

if (env('OUTSHIFT_API_KEY')) {
  subjects.push({
    name: 'outshift',
    raw: false,
    creditedH: '—',
    bytes: 4096,
    note: '~33% of the 100k bits/day budget',
    make: () => outshift({ apiKey: env('OUTSHIFT_API_KEY') }),
  })
}

if (env('RANDOM_ORG_API_KEY')) {
  subjects.push({
    name: 'random.org',
    raw: false,
    creditedH: '—',
    bytes: 16_384,
    note: '~52% of the 250k bits/day budget, single blob',
    make: () => randomOrg({ apiKey: env('RANDOM_ORG_API_KEY') }),
  })
}

if (env('SUPERRAND_API_KEY')) {
  subjects.push({
    name: 'superrand',
    raw: false,
    creditedH: '—',
    bytes: 8192,
    note: '~1.6% of the one-time 512 KiB allowance',
    make: () => superRand({ apiKey: env('SUPERRAND_API_KEY') }),
  })
}

subjects.push({
  name: 'drand',
  raw: false,
  creditedH: '—',
  bytes: 8192,
  note: 'PUBLIC beacon, 256 historical rounds',
  make: () => drand(),
})

subjects.push({
  name: 'nist-beacon',
  raw: false,
  creditedH: '—',
  bytes: 4096,
  note: 'PUBLIC beacon, 64 historical pulses',
  make: () => nistBeacon(),
})

// anu-legacy is deliberately absent: at 1 request/minute a meaningful sample
// would take hours, and the keyed `anu` reads the same physical source.

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
