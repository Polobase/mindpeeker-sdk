// Cookbook recipe 12 in the browser: a synthetic device with an injected
// fault, wrapped in serialEntropy's SP 800-90B health tests, run under
// onHealthFailure 'throw' and 'retest'.
// CLIENT-ONLY (it imports @mindpeeker/entropy).

import { defineProvider, EntropyError, type EntropyProvider } from '@mindpeeker/entropy'
import { serialEntropy } from '@mindpeeker/entropy/providers'
import { chiSquareBytes, mcvMinEntropy } from '@mindpeeker/negentropy'
import { drbgSource } from '~/lib/entropy'
import { errorInfo } from '~/lib/errors'

export type Fault = 'healthy' | 'stuck burst' | 'dead after 2 KiB' | 'biased'

export const FAULT_NOTE: Record<Fault, string> = {
  healthy: 'clean bytes straight from the seeded DRBG upstream.',
  'stuck burst': '16 bytes of 0xa5 injected at raw offset 2048 — the RCT’s target.',
  'dead after 2 KiB': 'every byte 0 from raw offset 2048 on — the device is gone.',
  biased: 'each bit is 1 with probability 17/32 — true min-entropy ≈ 7.30 b/B, above the 7 b/B credit.',
}

/** The min-entropy this simulated device claims, in bits per raw byte. */
export const CREDIT_BITS_PER_BYTE = 7
const STARTUP_SAMPLES = 1024

/**
 * A driver stub with a fault model, wrapped by `defineProvider` — which gives
 * it length checking, abort handling and timeouts for free. Its clean bytes
 * come from a fixed DRBG seed, so this whole simulation is reproducible.
 */
export function demoDevice(fault: Fault): EntropyProvider {
  const upstream = drbgSource('entropy page / health simulation')
  let offset = 0
  return defineProvider({
    name: `demo-device(${fault})`,
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
        if (fault === 'biased') out[i] = u(0) | (u(1) & u(2) & u(3) & u(4))
      }
      return {
        bytes: out,
        sources: [{ name: `demo-device(${fault})`, kind: 'trng', privacy: 'private' }],
      }
    },
  })
}

export interface HealthCase {
  readonly fault: Fault
  readonly mode: 'throw' | 'retest'
  readonly raw: boolean
}

export const HEALTH_CASES: readonly HealthCase[] = [
  { fault: 'healthy', mode: 'retest', raw: true },
  { fault: 'stuck burst', mode: 'throw', raw: true },
  { fault: 'stuck burst', mode: 'retest', raw: true },
  { fault: 'dead after 2 KiB', mode: 'retest', raw: true },
  { fault: 'biased', mode: 'retest', raw: true },
  { fault: 'biased', mode: 'retest', raw: false },
]

export interface HealthOutcome extends HealthCase {
  readonly label: string
  readonly delivered?: number
  readonly ms: number
  readonly code?: string
  readonly message?: string
  /** Byte-histogram χ² p over the delivered output (≥ 1024 bytes only). */
  readonly chi2P?: number
  /** SP 800-90B most-common-value min-entropy estimate of the output. */
  readonly mcv?: number
}

function caseLabel(c: HealthCase): string {
  return `${c.fault} · ${c.mode} · ${c.raw ? 'raw' : 'conditioned'}`
}

/** SP 800-90B start-up and continuous tests over the device's byte stream. */
function healthTested(c: HealthCase): EntropyProvider {
  return serialEntropy({
    source: demoDevice(c.fault).stream({ chunkBytes: 512 }),
    name: `tested(${c.fault})`,
    conditioning: c.raw ? 'raw' : 'conditioned',
    minEntropyPerSample: CREDIT_BITS_PER_BYTE,
    onHealthFailure: c.mode,
    maxHealthFailures: 3,
    warmupBytes: 0,
  })
}

/** Run one case. A health failure is a result, not an exception. */
export async function runHealthCase(
  c: HealthCase,
  bytes: number,
  signal?: AbortSignal,
): Promise<HealthOutcome> {
  const started = performance.now()
  try {
    const result = await healthTested(c).getBytes(bytes, { signal, timeoutMs: 30_000 })
    const ms = performance.now() - started
    const data = result.bytes
    return {
      ...c,
      label: caseLabel(c),
      delivered: data.length,
      ms,
      ...(data.length >= 1024
        ? { chi2P: chiSquareBytes(data).pValue, mcv: mcvMinEntropy(data) }
        : {}),
    }
  } catch (error) {
    if (!(error instanceof EntropyError)) throw error
    const info = errorInfo(error)
    return {
      ...c,
      label: caseLabel(c),
      ms: performance.now() - started,
      code: info.code ?? 'unknown',
      message: info.message,
    }
  }
}

/** Raw bytes a case reads before its first output byte (start-up test only). */
export const STARTUP_NOTE = `No output before ${STARTUP_SAMPLES} consecutive raw samples pass the tests — and after every alarm under 'retest'.`

export const HEALTH_SNIPPET = `import { defineProvider, EntropyError } from '@mindpeeker/entropy'
import { serialEntropy } from '@mindpeeker/entropy/providers'

const tested = serialEntropy({
  source: demoDevice(fault).stream({ chunkBytes: 512 }),
  name: \`tested(\${fault})\`,
  conditioning: 'raw',          // health-tested passthrough, no whitening
  minEntropyPerSample: 7,       // the credit you claim, in bits per raw byte
  onHealthFailure,              // 'throw' fails at alarm 1, 'retest' restarts
  maxHealthFailures: 3,         // the 3rd alarm of a session throws
  warmupBytes: 0,
})

try {
  const { bytes } = await tested.getBytes(2048)
} catch (error) {
  if (error instanceof EntropyError) console.log(error.code) // 'health_test'
}`
