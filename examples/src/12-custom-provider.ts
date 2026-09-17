/**
 * Recipe 12: a custom provider for your own device. defineProvider wraps the driver,
 * serialEntropy adds SP 800-90B health tests with restart semantics, and negentropy
 * analyses what comes out.
 * bun examples/src/12-custom-provider.ts [--source crypto] [--smoke]
 */
import { defineProvider, EntropyError, type EntropyProvider } from '@mindpeeker/entropy'
import { serialEntropy } from '@mindpeeker/entropy/providers'
import { analyzeBytes, chiSquareBytes, mcvMinEntropy } from '@mindpeeker/negentropy'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'

type Fault = 'healthy' | 'stuck burst' | 'dead after 2 KiB' | 'biased'
const args = parseArgs()
const upstream = openSource(args.source, 'device') // stands in for the physical noise

/** A driver stub with a fault model. defineProvider checks lengths, aborts and timeouts. */
function device(fault: Fault): EntropyProvider {
  let offset = 0
  return defineProvider({
    name: `bench-device(${fault})`,
    kind: 'trng',
    privacy: 'private',
    defaultChunkBytes: 512,
    async getBytes(n, opts) {
      const raw = (await upstream.getBytes(fault === 'biased' ? 5 * n : n, opts)).bytes
      const out = new Uint8Array(n)
      for (let i = 0; i < n; i++, offset++) {
        const u = (k: number) => raw[5 * i + k] as number
        out[i] = raw[i] as number
        if (fault === 'stuck burst' && offset >= 2048 && offset < 2064) out[i] = 0xa5
        if (fault === 'dead after 2 KiB' && offset >= 2048) out[i] = 0
        if (fault === 'biased') out[i] = u(0) | (u(1) & u(2) & u(3) & u(4)) // P(bit = 1) = 17/32
      }
      return {
        bytes: out,
        sources: [{ name: `bench-device(${fault})`, kind: 'trng', privacy: 'private' }],
      }
    },
  })
}

/** SP 800-90B start-up and continuous tests over the device's byte stream. */
function healthTested(
  fault: Fault,
  onHealthFailure: 'throw' | 'retest',
  raw = true,
): EntropyProvider {
  return serialEntropy({
    source: device(fault).stream({ chunkBytes: 512 }),
    name: `tested(${fault})`,
    conditioning: raw ? 'raw' : 'conditioned',
    minEntropyPerSample: 7, // the credit you claim for your device, in bits per byte
    onHealthFailure,
    maxHealthFailures: 3,
    warmupBytes: 0,
  })
}

const bytes = size(args, 16_384, 4_096)
const outputs: { label: string; bytes: Uint8Array }[] = []
const cases: [Fault, 'throw' | 'retest', boolean][] = [
  ['healthy', 'retest', true],
  ['stuck burst', 'throw', true],
  ['stuck burst', 'retest', true],
  ['dead after 2 KiB', 'retest', true],
  ['biased', 'retest', true],
  ['biased', 'retest', false],
]
for (const [fault, mode, raw] of cases) {
  const label = `${fault}, ${mode}, ${raw ? 'raw' : 'conditioned'}`
  try {
    const result = await healthTested(fault, mode, raw).getBytes(bytes)
    outputs.push({ label, bytes: result.bytes })
    console.log(label.padEnd(34), `delivered ${result.bytes.length} bytes`)
  } catch (error) {
    if (!(error instanceof EntropyError)) throw error
    console.log(label.padEnd(34), `failed: ${error.code}`)
  }
}

// Health tests certify the credited min-entropy, not fairness. Ask the statistics.
const steps = Math.floor((bytes * 8) / 200)
for (const { label, bytes: data } of outputs) {
  const result = analyzeBytes([{ source: label, bytes: data }], {
    events: [{ id: 'whole-output', statistic: 'netvar', start: 0, end: steps }],
  })
  const event = result.events[0]
  console.log(
    label.padEnd(34),
    `netvar z ${fmt(event?.z ?? Number.NaN)}`,
    `byte χ² p ${fmt(chiSquareBytes(data).pValue)}`,
    `MCV H ${fmt(mcvMinEntropy(data), 2)} b/B`,
  )
}
