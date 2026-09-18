// The local physical sources that can run inside a browser tab, with what
// each one needs from the user and how long a conditioned block takes.
// CLIENT-ONLY (it imports @mindpeeker/entropy/providers).

import type { EntropyProvider } from '@mindpeeker/entropy'
import type { SerialPortLike } from '@mindpeeker/entropy/providers'
import {
  cameraEntropy,
  jitterEntropy,
  micEntropy,
  sensorEntropy,
  serialEntropy,
} from '@mindpeeker/entropy/providers'
import { bytesPerBlock } from './credits'

export type LocalId = 'jitter' | 'mic' | 'camera' | 'sensor' | 'serial'

export type Conditioning = 'conditioned' | 'raw'

export interface LocalSpec {
  readonly id: LocalId
  readonly title: string
  readonly icon: string
  readonly factory: string
  readonly api: readonly string[]
  readonly physics: string
  /** What the user is asked for, or '' when nothing is. */
  readonly permission: string
  /** Credited min-entropy in bits per raw byte and the pooling factor. */
  readonly h: number
  readonly safetyFactor: number
  readonly healthH?: number
  readonly defaultConditioning: Conditioning
  /** Per-pull budget; camera warm-up and jitter pooling need generous ones. */
  readonly timeoutMs: number
  readonly notes: readonly string[]
  readonly snippet: string
  /** Needs a user gesture before the provider can be built (Web Serial). */
  readonly needsPort?: boolean
}

export const LOCAL_SPECS: readonly LocalSpec[] = [
  {
    id: 'jitter',
    title: 'CPU timing jitter',
    icon: 'i-lucide-cpu',
    factory: "jitterEntropy({ allowCoarseClock: true })",
    api: ['jitterEntropy', 'jitterStartupTest'],
    physics: 'CPU micro-architectural timing chaos — the weakest physical claim in the package.',
    permission: '',
    h: 0.01,
    safetyFactor: 2,
    healthH: 0.0625,
    defaultConditioning: 'raw',
    timeoutMs: 40_000,
    notes: [
      'Browsers only expose a coarse clock (performance.now), so the provider refuses unless you pass allowCoarseClock: true and renames itself jitter(coarse): real but UNQUANTIFIED entropy — mix it via xorMix, never use it alone.',
      'Sampling busy-waits by design: 64 samples of 0.5 ms each, then a macrotask yield — so it works in ~32 ms slices and the page stays responsive between them.',
      'Coarse mode counts how many memory-walk operations fit in a 0.5 ms window; the credit is 0.01 bit per sample, while the health tests run at the stricter 1/16 bit (APT 509 of 512).',
      'Node’s nanosecond hrtime path additionally runs jitterStartupTest — a port of jitterentropy’s power-up checks — and fails with health_test on a stuck, coarse or non-monotonic clock.',
    ],
    snippet: `import { jitterEntropy } from '@mindpeeker/entropy/providers'

const jitter = jitterEntropy({ allowCoarseClock: true, conditioning: 'raw' })
for await (const chunk of jitter.stream({ chunkBytes: 32, signal })) {
  // health-tested samples; the provider is named jitter(coarse)(raw)
}`,
  },
  {
    id: 'mic',
    title: 'Microphone ADC noise',
    icon: 'i-lucide-mic',
    factory: 'micEntropy()',
    api: ['micEntropy', 'sampleLsbBits'],
    physics: 'Johnson (thermal) noise in the microphone preamp and ADC.',
    permission: 'microphone',
    h: 2,
    safetyFactor: 4,
    defaultConditioning: 'conditioned',
    timeoutMs: 20_000,
    notes: [
      'Keeps the least-significant bit of each 16-bit sample (bitsPerSample: 1, 2 or 4) after discarding 200 ms of warm-up audio.',
      'Measured 7.40 bits/byte raw on a MacBook mic against a credited 2 — the 4× pooling factor leaves room for worse hardware.',
      'Denying the permission prompt throws EntropyError(\'permission\'); browser capture keeps at most queueLimit (8) buffers and drops the oldest.',
    ],
    snippet: `import { micEntropy } from '@mindpeeker/entropy/providers'

const mic = micEntropy()                    // getUserMedia({ audio: true })
const { bytes, sources } = await mic.getBytes(32)
// sources[0].name === 'microphone'`,
  },
  {
    id: 'camera',
    title: 'Camera sensor noise',
    icon: 'i-lucide-camera',
    factory: 'cameraEntropy()',
    api: ['cameraEntropy', 'signBits', 'lsbBits'],
    physics: 'Photon shot noise (lit scene — quantum) and sensor thermal noise (covered lens — classical).',
    permission: 'camera',
    h: 1,
    safetyFactor: 8,
    defaultConditioning: 'conditioned',
    timeoutMs: 25_000,
    notes: [
      'Frame-diff sign bits at stride 4 (AetherOnePi-style), von Neumann debiased, after 10 warm-up frames while auto-exposure settles.',
      'Cover the lens for pure thermal noise; a frozen scene produces no samples at all and ends in timeout rather than fake entropy.',
      'Measured 7.02 bits/byte raw against a credited 1 — the deliberately paranoid 8× credit is why small conditioned reads feel slow.',
    ],
    snippet: `import { cameraEntropy } from '@mindpeeker/entropy/providers'

const cam = cameraEntropy()                      // whitened, 8× credit
const raw = cameraEntropy({ conditioning: 'raw' }) // unwhitened sign bits
const { bytes } = await cam.getBytes(32)`,
  },
  {
    id: 'sensor',
    title: 'Motion sensors',
    icon: 'i-lucide-smartphone',
    factory: 'sensorEntropy()',
    api: ['sensorEntropy', 'sensorReadingBytes'],
    physics: 'Thermal and mechanical noise in MEMS accelerometers and gyroscopes.',
    permission: 'motion sensors (iOS asks explicitly)',
    h: 0.25,
    safetyFactor: 4,
    healthH: 1,
    defaultConditioning: 'raw',
    timeoutMs: 15_000,
    notes: [
      'Generic Sensor API with a DeviceMotion fallback; each event contributes only the axes of the sensor that fired.',
      'Browsers quantize readings to 0.1 m/s² / 0.1 °/s, so the credit is 0.25 bit per axis byte — 0.75 bits per 3-axis event. Move the device.',
      'The health tests run at a stricter 1 bit/byte, so a device lying still trips them instead of producing fake entropy; an iOS refusal throws permission at once.',
      'On a desktop the event type exists but no events ever fire: the read starves and ends in timeout after 15 s. That is the starvation guard working, not a bug — this source belongs on a phone.',
    ],
    snippet: `import { sensorEntropy } from '@mindpeeker/entropy/providers'

const motion = sensorEntropy({ conditioning: 'raw' })
for await (const chunk of motion.stream({ chunkBytes: 16, signal })) {
  // one 6-axis DeviceMotion event carries ~1.5 credited bits
}`,
  },
  {
    id: 'serial',
    title: 'Serial hardware (ESP32 / TrueRNG / OneRNG)',
    icon: 'i-lucide-usb',
    factory: "serialEntropy({ port, name: 'esp32' })",
    api: ['serialEntropy', 'truerng', 'onerng'],
    physics: 'SAR-ADC thermal/RF noise on the board (ESP32 bootloader_random).',
    permission: 'a serial port you pick in the browser dialog',
    h: 7,
    safetyFactor: 2,
    defaultConditioning: 'conditioned',
    timeoutMs: 20_000,
    needsPort: true,
    notes: [
      'Web Serial needs a user gesture on an HTTPS page; Chromium 89+ (Android 148) and Firefox 151+ support it.',
      'The AetherOnePi ESP32 sketch streams raw esp_fill_random bytes at 921 600 baud — the fastest physical source measured here at ~69 KiB/s raw.',
      'TrueRNGpro and OneRNG have their own presets (truerng/onerng): a baud-rate knock and a command sequence the plain factory will not send.',
    ],
    snippet: `import { serialEntropy } from '@mindpeeker/entropy/providers'

const port = await navigator.serial.requestPort()   // user gesture required
const hw = serialEntropy({ port, name: 'esp32' })   // 921600 baud by default
for await (const chunk of hw.stream({ chunkBytes: 256, signal })) { /* … */ }`,
  },
]

export function localSpec(id: LocalId): LocalSpec {
  return LOCAL_SPECS.find((s) => s.id === id) as LocalSpec
}

/** Raw bytes behind one 32-byte block at this source's credit. */
export function blockCost(spec: LocalSpec): number {
  return bytesPerBlock(spec.h, spec.safetyFactor)
}

export interface Availability {
  readonly ok: boolean
  readonly reason?: string
}

/** Feature detection, so an unsupported source says why instead of failing. */
export function availability(id: LocalId): Availability {
  if (typeof window === 'undefined') return { ok: false, reason: 'no browser' }
  const nav = navigator as Navigator & { serial?: unknown }
  switch (id) {
    case 'jitter':
      return typeof performance?.now === 'function'
        ? { ok: true }
        : { ok: false, reason: 'no usable clock in this runtime' }
    case 'mic':
    case 'camera':
      return typeof nav.mediaDevices?.getUserMedia === 'function'
        ? { ok: true }
        : { ok: false, reason: 'getUserMedia is unavailable (needs HTTPS or localhost)' }
    case 'sensor':
      return 'DeviceMotionEvent' in window || 'Accelerometer' in window
        ? { ok: true }
        : { ok: false, reason: 'this device exposes no motion sensors' }
    case 'serial':
      return nav.serial
        ? { ok: true }
        : { ok: false, reason: 'navigator.serial is missing — use Chromium 89+ or Firefox 151+ over HTTPS' }
  }
}

/** Ask the user for a serial port. Must be called straight from a click. */
export async function requestSerialPort(): Promise<SerialPortLike> {
  const nav = navigator as Navigator & {
    serial?: { requestPort: () => Promise<SerialPortLike> }
  }
  if (!nav.serial) throw new Error('Web Serial is not available in this browser')
  return await nav.serial.requestPort()
}

/** Build one local provider. `port` is required for the serial source. */
export function makeLocal(
  id: LocalId,
  conditioning: Conditioning,
  port?: SerialPortLike,
): EntropyProvider {
  switch (id) {
    case 'jitter':
      return jitterEntropy({ allowCoarseClock: true, conditioning })
    case 'mic':
      return micEntropy({ conditioning })
    case 'camera':
      return cameraEntropy({ conditioning })
    case 'sensor':
      return sensorEntropy({ conditioning })
    case 'serial':
      if (!port) throw new Error('pick a serial port first')
      return serialEntropy({ port, name: 'esp32', conditioning })
  }
}
