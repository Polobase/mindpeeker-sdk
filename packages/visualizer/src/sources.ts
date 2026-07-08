/**
 * Entropy-source registry for the `mindpeeker-viz` demo. Maps a source name
 * (`crypto`, `jitter`, `esp32`/`serial`, `camera`, `mic`, `hwrng`) to a live
 * byte provider, wiring the Bun-only `@mindpeeker/entropy/node` capture
 * adapters (ffmpeg, serial `stty`, `/dev/hwrng`) for the physical sources.
 *
 * Every builder is I/O-free: hardware is opened only when a provider's
 * `stream()` is first pulled, so resolving a source never touches a device —
 * which keeps this unit testable without hardware and lets the CLI print the
 * dashboard URL before capture starts. Bun/Node only.
 */

import {
  ffmpegFrameSource,
  ffmpegSampleSource,
  hwRng,
  nodeSerialSource,
} from '@mindpeeker/entropy/node'
import {
  cameraEntropy,
  cryptoProvider,
  jitterEntropy,
  micEntropy,
  serialEntropy,
} from '@mindpeeker/entropy/providers'

/**
 * The minimal structural view of an entropy provider the dashboard consumes —
 * a name plus a lazy, pull-based byte stream. Every `@mindpeeker/entropy`
 * provider satisfies this without an import.
 */
export interface ByteProvider {
  readonly name: string
  stream(opts?: { signal?: AbortSignal; chunkBytes?: number }): AsyncIterable<Uint8Array>
}

/** Per-source knobs, all optional; sensible per-platform defaults fill the gaps. */
export interface SourceOptions {
  /** Pass the hardware's raw samples through (health-tested) instead of SHA-256 conditioning. */
  raw?: boolean
  /** Serial device path. Default `/dev/cu.usbserial-110` (macOS) or `/dev/ttyUSB0` (Linux). */
  serialPath?: string
  /** Serial baud rate. Default 921_600 (AetherOnePi ESP32 firmware). */
  baudRate?: number
  /** Camera capture device: avfoundation index (macOS, e.g. `'0'`) or v4l2 path (Linux). */
  cameraDevice?: string
  /** Microphone capture device: avfoundation spec (macOS, e.g. `':0'`) or ALSA name (Linux). */
  micDevice?: string
  /** Kernel hardware-RNG character device. Default `/dev/hwrng`. */
  hwrngPath?: string
}

/** A resolved source: the provider plus a human note about what it needs. */
export interface ResolvedSource {
  readonly provider: ByteProvider
  /** One-line note on hardware/tooling requirements, shown by the CLI. */
  readonly note: string
}

const isDarwin = process.platform === 'darwin'

function conditioning(opts: SourceOptions): 'raw' | 'conditioned' {
  return opts.raw ? 'raw' : 'conditioned'
}

/**
 * Wrap the async, device-opening `nodeSerialSource` so the port is opened only
 * on first pull (never at resolve time), and re-opened per session. One
 * `stream()` call ⇒ one device open — pair with a fan-out upstream so a single
 * physical port feeds every panel.
 */
function serialProvider(opts: SourceOptions, name: string): ByteProvider {
  const path = opts.serialPath ?? (isDarwin ? '/dev/cu.usbserial-110' : '/dev/ttyUSB0')
  const baudRate = opts.baudRate ?? 921_600
  return {
    name,
    async *stream(streamOpts) {
      const source = await nodeSerialSource({ path, baudRate })
      const provider = serialEntropy({ source, name, conditioning: conditioning(opts) })
      yield* provider.stream(streamOpts)
    },
  }
}

interface SourceEntry {
  /** Short description for `--list-sources`. */
  readonly describe: string
  readonly build: (opts: SourceOptions) => ResolvedSource
}

const REGISTRY: Readonly<Record<string, SourceEntry>> = Object.freeze({
  crypto: {
    describe: 'software CSPRNG (crypto.getRandomValues) — always available',
    build: () => ({
      provider: cryptoProvider(),
      note: 'software CSPRNG — no hardware needed',
    }),
  },
  jitter: {
    describe: 'CPU timing jitter — no hardware, ~9 KiB/s',
    build: (opts) => ({
      provider: jitterEntropy({ conditioning: conditioning(opts) }),
      note: 'CPU clock jitter — no hardware, slow (~9 KiB/s)',
    }),
  },
  serial: {
    describe: 'serial/ESP32 TRNG (AetherOnePi firmware) via a USB serial port',
    build: (opts) => {
      const path = opts.serialPath ?? (isDarwin ? '/dev/cu.usbserial-110' : '/dev/ttyUSB0')
      return {
        provider: serialProvider(opts, 'serial'),
        note: `serial TRNG at ${path} @ ${opts.baudRate ?? 921_600} baud`,
      }
    },
  },
  esp32: {
    describe: 'alias of `serial` labelled esp32 (AetherOnePi raw serial stream)',
    build: (opts) => {
      const path = opts.serialPath ?? (isDarwin ? '/dev/cu.usbserial-110' : '/dev/ttyUSB0')
      return {
        provider: serialProvider(opts, 'esp32'),
        note: `ESP32 TRNG at ${path} @ ${opts.baudRate ?? 921_600} baud (AetherOnePi firmware)`,
      }
    },
  },
  camera: {
    describe: 'webcam sensor noise via ffmpeg (frame-diff sign bits)',
    build: (opts) => {
      const device = opts.cameraDevice ?? (isDarwin ? '0' : '/dev/video0')
      return {
        provider: cameraEntropy({
          source: ffmpegFrameSource({ device }),
          conditioning: conditioning(opts),
        }),
        note: `camera ${device} via ffmpeg — needs ffmpeg installed and an uncovered camera`,
      }
    },
  },
  mic: {
    describe: 'microphone thermal/ambient noise via ffmpeg (sample LSBs)',
    build: (opts) => {
      const device = opts.micDevice ?? (isDarwin ? ':0' : 'default')
      return {
        provider: micEntropy({
          source: ffmpegSampleSource({ device }),
          conditioning: conditioning(opts),
        }),
        note: `microphone ${device} via ffmpeg — needs ffmpeg installed`,
      }
    },
  },
  hwrng: {
    describe: 'kernel hardware RNG /dev/hwrng (Linux/Pi/ChaosKey; usually root-only)',
    build: (opts) => {
      const path = opts.hwrngPath ?? '/dev/hwrng'
      return {
        provider: hwRng({
          ...(opts.hwrngPath !== undefined && { path: opts.hwrngPath }),
          conditioning: conditioning(opts),
        }),
        note: `kernel hardware RNG ${path} — Linux/Pi only, usually root-only`,
      }
    },
  },
})

/** Alias → canonical source name. */
const ALIASES: Readonly<Record<string, string>> = Object.freeze({
  microphone: 'mic',
  csprng: 'crypto',
})

/** All resolvable source names (canonical, excluding aliases), for help text and validation. */
export const SOURCE_NAMES: readonly string[] = Object.freeze(Object.keys(REGISTRY))

/** `name → one-line description` for `--list-sources`. */
export function sourceDescriptions(): ReadonlyArray<{ name: string; describe: string }> {
  return SOURCE_NAMES.map((name) => ({
    name,
    describe: (REGISTRY[name] as SourceEntry).describe,
  }))
}

/**
 * Resolve a source name (or alias) to a lazy provider plus a requirements note.
 *
 * @throws {RangeError} if the name is not a known source; the message lists the
 *   valid names.
 */
export function resolveSource(name: string, opts: SourceOptions = {}): ResolvedSource {
  const canonical = ALIASES[name] ?? name
  const entry = REGISTRY[canonical]
  if (!entry) {
    throw new RangeError(`unknown source "${name}" — choose one of: ${SOURCE_NAMES.join(', ')}`)
  }
  return entry.build(opts)
}
