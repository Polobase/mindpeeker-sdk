import { EntropyError } from '../errors.js'
import { packBits, vonNeumann } from '../internal/bits.js'
import type { ConditioningOptions } from '../internal/condition.js'
import { requireInteger, requireOneOf } from '../internal/options.js'
import { permissionError, starvationGuard } from '../internal/queue.js'
import { sleep } from '../internal/rate-limit.js'
import { sampledProvider } from '../internal/sampled.js'
import type { EntropyProvider } from '../types.js'

export interface Frame {
  width: number
  height: number
  /** RGBA (channels 4, e.g. canvas ImageData) or single-channel (1, e.g. rawvideo gray). */
  data: Uint8ClampedArray | Uint8Array
  channels: 1 | 4
}

export interface FrameSource {
  /** A fresh frame iterable per session; stop capturing in the generator's finally. */
  frames(signal?: AbortSignal): AsyncIterable<Frame>
  close?(): void | Promise<void>
}

export interface CameraOptions extends ConditioningOptions {
  /** Injected frames (Node, tests). Default: getUserMedia + canvas (browser only). */
  source?: FrameSource
  /** getUserMedia video constraints. Default { width: 640, height: 480 }. */
  constraints?: MediaTrackConstraints
  /** Pixel subsampling stride (integer ≥ 1) — breaks adjacent-pixel correlation. Default 4. */
  stride?: number
  /** Frames (integer ≥ 0) discarded at session start while auto-exposure/AGC settles. Default 10. */
  warmupFrames?: number
  /**
   * Bit extraction: 'sign' (frame-diff sign, AetherOnePi-style, default) or
   * 'lsb'. In lsb mode a frame whose sampled pixels equal the previous
   * frame's (a duplicated or frozen frame) is skipped, never credited twice.
   */
  bits?: 'sign' | 'lsb'
  /**
   * Von Neumann debiasing over the bit stream before packing. Default TRUE:
   * auto-exposure drift and mains-flicker make whole frames brighten or
   * darken together, producing long identical-bit runs that rightly trip the
   * health tests — debiasing drops those correlated runs. Disable for the
   * unprocessed AetherOnePi-style bit stream.
   */
  debias?: boolean
}

function channelOffset(channels: 1 | 4): number {
  return channels === 4 ? 1 : 0 // green channel for RGBA
}

function requireStride(stride: number): number {
  return requireInteger(stride, 'stride', 1, 'camera')
}

/**
 * Frame-diff sign extraction: brighter pixel → 1, darker → 0, unchanged →
 * no bit. Compares the green (or only) channel of every stride-th pixel.
 * `stride` must be an integer ≥ 1 (`EntropyError('invalid_request')`).
 */
export function signBits(prev: Frame, cur: Frame, stride: number): number[] {
  const step = requireStride(stride) * cur.channels
  const length = Math.min(prev.data.length, cur.data.length)
  const bits: number[] = []
  for (let i = channelOffset(cur.channels); i < length; i += step) {
    const a = prev.data[i] as number
    const b = cur.data[i] as number
    if (b > a) bits.push(1)
    else if (b < a) bits.push(0)
  }
  return bits
}

/**
 * Least-significant bit of every stride-th pixel's green (or only) channel.
 * `stride` must be an integer ≥ 1 (`EntropyError('invalid_request')`).
 */
export function lsbBits(frame: Frame, stride: number): number[] {
  const step = requireStride(stride) * frame.channels
  const bits: number[] = []
  for (let i = channelOffset(frame.channels); i < frame.data.length; i += step) {
    bits.push((frame.data[i] as number) & 1)
  }
  return bits
}

/**
 * True when two frames agree on every sampled pixel (green or only channel
 * of every stride-th pixel) — a duplicated or frozen frame carries no fresh
 * sensor noise on the sampling grid.
 */
export function sameSampledPixels(a: Frame, b: Frame, stride: number): boolean {
  if (a.channels !== b.channels || a.data.length !== b.data.length) return false
  const step = requireStride(stride) * b.channels
  for (let i = channelOffset(b.channels); i < b.data.length; i += step) {
    if (a.data[i] !== b.data[i]) return false
  }
  return true
}

const FRAME_INTERVAL_MS = 100 // ~10 fps is plenty for entropy harvesting

function browserFrameSource(constraints: MediaTrackConstraints): FrameSource {
  return {
    async *frames(signal?: AbortSignal) {
      const mediaDevices = (globalThis as { navigator?: Navigator }).navigator?.mediaDevices
      if (typeof mediaDevices?.getUserMedia !== 'function') {
        throw new EntropyError(
          'invalid_request',
          'cameraEntropy: no camera in this runtime — pass a { source } (in Node: ffmpegFrameSource from @mindpeeker/entropy/node)',
          { provider: 'camera' },
        )
      }
      let stream: MediaStream
      try {
        stream = await mediaDevices.getUserMedia({ video: constraints })
      } catch (error) {
        throw permissionError(error, 'camera', 'camera')
      }
      try {
        const video = document.createElement('video')
        video.srcObject = stream
        video.muted = true
        await video.play()
        const width = video.videoWidth || 640
        const height = video.videoHeight || 480
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) {
          throw new EntropyError('network', 'cameraEntropy: 2d canvas context unavailable', {
            provider: 'camera',
          })
        }
        while (true) {
          context.drawImage(video, 0, 0)
          const image = context.getImageData(0, 0, width, height)
          yield { width, height, data: image.data, channels: 4 as const }
          await sleep(FRAME_INTERVAL_MS, signal)
        }
      } finally {
        for (const track of stream.getTracks()) track.stop()
      }
    },
  }
}

/**
 * Camera sensor noise (photon shot noise in lit scenes, thermal noise with
 * the lens covered). Raw mode emits the packed frame-diff sign bits — the
 * honest unwhitened physical signal. Auto-exposure and ISP processing vary
 * wildly between devices; the built-in health tests are the guard.
 *
 * Throws `EntropyError('invalid_request')` at construction for a non-integer
 * or < 1 `stride`, a non-integer or negative `warmupFrames`, an unknown
 * `bits` mode, or out-of-range conditioning options.
 */
export function cameraEntropy(opts: CameraOptions = {}): EntropyProvider {
  const { constraints = { width: 640, height: 480 }, debias = true } = opts
  const stride = requireStride(opts.stride ?? 4)
  const warmupFrames = requireInteger(opts.warmupFrames ?? 10, 'warmupFrames', 0, 'camera')
  const bits = requireOneOf(opts.bits ?? 'sign', ['sign', 'lsb'] as const, 'bits', 'camera')
  const source = opts.source ?? browserFrameSource(constraints)

  async function* open(signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    let previous: Frame | null = null
    let skipped = 0
    let leftover: number[] = []
    const tick = starvationGuard(signal)
    for await (const frame of source.frames(signal)) {
      // cooperative abort: a frozen scene yields frames but never bytes, so
      // this loop must observe the signal itself
      if (signal?.aborted) throw signal.reason ?? new DOMException('aborted', 'AbortError')
      if (skipped < warmupFrames) {
        skipped++
        previous = frame
        await tick(false)
        continue
      }
      let frameBits: number[]
      if (bits === 'sign') {
        if (!previous) {
          previous = frame
          await tick(false)
          continue
        }
        frameBits = signBits(previous, frame, stride)
      } else {
        if (previous && sameSampledPixels(previous, frame, stride)) {
          await tick(false)
          continue
        }
        frameBits = lsbBits(frame, stride)
      }
      previous = frame
      if (debias) frameBits = vonNeumann(frameBits)
      const [bytes, rest] = packBits(leftover.concat(frameBits))
      leftover = rest
      if (bytes.length > 0) yield bytes
      await tick(bytes.length > 0)
    }
  }

  return sampledProvider(
    {
      name: 'camera',
      kind: 'trng',
      privacy: 'private',
      open,
      defaultMinEntropyPerSample: 1,
      defaultSafetyFactor: 8,
      defaultTimeoutMs: 30_000, // permission prompt + AGC warmup
    },
    opts,
  )
}
