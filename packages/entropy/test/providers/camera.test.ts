import { afterEach, describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { packBits, vonNeumann } from '../../src/internal/bits.js'
import {
  cameraEntropy,
  type Frame,
  type FrameSource,
  lsbBits,
  sameSampledPixels,
  signBits,
} from '../../src/providers/camera.js'
import { providerContract } from '../helpers/provider-contract.js'

function gray(pixels: number[]): Frame {
  return { width: pixels.length, height: 1, data: new Uint8Array(pixels), channels: 1 }
}

function rgba(pixels: number[][]): Frame {
  const data = new Uint8Array(pixels.length * 4)
  pixels.forEach((px, i) => {
    data.set(px, i * 4)
  })
  return { width: pixels.length, height: 1, data, channels: 4 }
}

/** Deterministic xorshift32 gray frames. */
function randomFrames(count: number, pixelCount: number, seed = 0xfeedface): Frame[] {
  let state = seed
  const frames: Frame[] = []
  for (let f = 0; f < count; f++) {
    const data = new Uint8Array(pixelCount)
    for (let i = 0; i < pixelCount; i++) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      state >>>= 0
      data[i] = state & 0xff
    }
    frames.push({ width: pixelCount, height: 1, data, channels: 1 })
  }
  return frames
}

/** Replays frames (microtask-only — no timers, like an in-memory recording). */
function replay(frames: readonly Frame[]): FrameSource {
  return {
    async *frames() {
      yield* frames
    },
  }
}

/** Fresh PRNG frames per session — supports repeated getBytes calls. */
function prngFrames(pixelCount = 1024, delayMs = 0): FrameSource {
  let state = 0xfeedface
  return {
    async *frames() {
      while (true) {
        const data = new Uint8Array(pixelCount)
        for (let i = 0; i < pixelCount; i++) {
          state ^= state << 13
          state ^= state >>> 17
          state ^= state << 5
          state >>>= 0
          data[i] = state & 0xff
        }
        yield { width: pixelCount, height: 1, data, channels: 1 as const }
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs))
      }
    },
  }
}

function expectInvalid(fn: () => unknown): void {
  let err: unknown
  try {
    fn()
  } catch (e) {
    err = e
  }
  expect(err).toBeInstanceOf(EntropyError)
  expect((err as EntropyError).code).toBe('invalid_request')
}

describe('signBits', () => {
  test('brighter→1, darker→0, equal skipped (single channel)', () => {
    expect(signBits(gray([10, 20, 30]), gray([20, 10, 30]), 1)).toEqual([1, 0])
  })

  test('reads the green channel for RGBA frames', () => {
    const prev = rgba([
      [0, 100, 0, 255],
      [0, 50, 0, 255],
    ])
    const cur = rgba([
      [255, 90, 255, 255], // green 100→90 → 0
      [0, 60, 0, 255], // green 50→60 → 1
    ])
    expect(signBits(prev, cur, 1)).toEqual([0, 1])
  })

  test('applies the subsampling stride', () => {
    const prev = gray([0, 0, 0, 0, 0, 0])
    const cur = gray([1, 9, 9, 1, 9, 9])
    expect(signBits(prev, cur, 3)).toEqual([1, 1]) // pixels 0 and 3 only
  })

  test('applies the stride per pixel on RGBA frames (step = stride × 4)', () => {
    const prev = rgba([
      [0, 10, 0, 0],
      [0, 10, 0, 0],
      [0, 10, 0, 0],
    ])
    const cur = rgba([
      [0, 20, 0, 0],
      [0, 0, 0, 0],
      [0, 5, 0, 0],
    ])
    expect(signBits(prev, cur, 2)).toEqual([1, 0]) // pixels 0 and 2
  })

  test('a stride of 0, negative or fractional is rejected instead of hanging', () => {
    for (const bad of [0, -1, 0.5]) expectInvalid(() => signBits(gray([1]), gray([2]), bad))
  })
})

describe('lsbBits', () => {
  test('extracts pixel LSBs with stride', () => {
    expect(lsbBits(gray([2, 3, 5, 4]), 1)).toEqual([0, 1, 1, 0])
    expect(lsbBits(gray([2, 3, 5, 4]), 2)).toEqual([0, 1])
  })

  test('rejects an invalid stride', () => {
    expectInvalid(() => lsbBits(gray([1, 2]), 0))
  })
})

describe('sameSampledPixels', () => {
  test('compares only the sampled grid', () => {
    expect(sameSampledPixels(gray([1, 2, 3, 4]), gray([1, 2, 3, 4]), 1)).toBe(true)
    expect(sameSampledPixels(gray([1, 2, 3, 4]), gray([1, 9, 3, 4]), 1)).toBe(false)
    expect(sameSampledPixels(gray([1, 2, 3, 4]), gray([1, 9, 3, 9]), 2)).toBe(true)
  })
})

providerContract(
  'cameraEntropy (scripted frames)',
  () => cameraEntropy({ source: prngFrames(), stride: 1, warmupFrames: 0 }),
  { kind: 'trng', privacy: 'private', lengths: [1, 16, 64] },
)

describe('cameraEntropy', () => {
  afterEach(() => {
    delete (navigator as { mediaDevices?: unknown }).mediaDevices
  })

  test('is named camera; raw mode is camera(raw)', () => {
    expect(cameraEntropy({ source: prngFrames() }).name).toBe('camera')
    expect(cameraEntropy({ source: prngFrames(), conditioning: 'raw' }).name).toBe('camera(raw)')
  })

  test('validates stride, warmupFrames and bits at construction', () => {
    const source = prngFrames()
    for (const stride of [0, -4, 1.5, Number.NaN]) {
      expectInvalid(() => cameraEntropy({ source, stride }))
    }
    for (const warmupFrames of [-1, 2.5]) {
      expectInvalid(() => cameraEntropy({ source, warmupFrames }))
    }
    expectInvalid(() => cameraEntropy({ source, bits: 'msb' as 'lsb' }))
    expectInvalid(() => cameraEntropy({ source, safetyFactor: 0 }))
  })

  test('debias defaults to on (guards against exposure/flicker bit runs)', async () => {
    // monotonically brightening frames produce only 1-bits; with default
    // von Neumann debiasing they must yield NO output instead of 0xff runs
    let level = 0
    const source: FrameSource = {
      async *frames() {
        while (true) {
          yield gray(new Array(64).fill(level++ % 250))
          await new Promise((r) => setTimeout(r, 1))
        }
      },
    }
    const err = await cameraEntropy({ source, warmupFrames: 0, conditioning: 'raw' })
      .getBytes(4, { timeoutMs: 60 })
      .catch((e) => e)
    expect((err as { code?: string }).code).toBe('timeout')
  })

  test('discards warmup frames, then diffs against the last warmup frame', async () => {
    const frames = randomFrames(400, 256)
    const { bytes } = await cameraEntropy({
      source: replay(frames),
      stride: 1,
      warmupFrames: 2,
      conditioning: 'raw',
      debias: false,
    }).getBytes(1)
    // frames 0 and 1 are warmup; the first bits are sign(frame 2 − frame 1)
    const [expected] = packBits(signBits(frames[1] as Frame, frames[2] as Frame, 1))
    expect(bytes[0]).toBe(expected[0] as number)
  })

  test('debias runs von Neumann over the sign bits', async () => {
    const frames = randomFrames(600, 256, 0x1234)
    const { bytes } = await cameraEntropy({
      source: replay(frames),
      stride: 1,
      warmupFrames: 0,
      debias: true,
      conditioning: 'raw',
    }).getBytes(2)
    const bits = vonNeumann(signBits(frames[0] as Frame, frames[1] as Frame, 1))
    const [expected] = packBits(bits)
    expect(Array.from(bytes)).toEqual(Array.from(expected.slice(0, 2)))
  })

  test('frozen frames starve the pipeline into timeout', async () => {
    const still = gray(new Array(64).fill(128))
    const source: FrameSource = {
      async *frames() {
        while (true) {
          yield still
          await new Promise((r) => setTimeout(r, 1))
        }
      },
    }
    const err = (await cameraEntropy({ source, warmupFrames: 0 })
      .getBytes(4, { timeoutMs: 60 })
      .catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('timeout')
  })

  test('a frozen in-memory replay (no timers at all) still times out instead of hanging', async () => {
    const still = gray(new Array(64).fill(128))
    const source: FrameSource = {
      async *frames() {
        while (true) yield still
      },
    }
    const err = (await cameraEntropy({ source, warmupFrames: 0 })
      .getBytes(4, { timeoutMs: 80 })
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('timeout')
  })

  test('lsb mode extracts without needing frame pairs', async () => {
    const frames = randomFrames(40, 256, 0xabcd)
    const { bytes } = await cameraEntropy({
      source: replay(frames),
      stride: 1,
      warmupFrames: 0,
      bits: 'lsb',
      conditioning: 'raw',
      debias: false,
    }).getBytes(32)
    // frame 0 alone supplies 256 LSBs = 32 bytes
    const [expected] = packBits(lsbBits(frames[0] as Frame, 1))
    expect(bytes).toEqual(expected)
  })

  test('lsb mode skips duplicated frames instead of crediting them twice', async () => {
    const frames = randomFrames(40, 256, 0x5151)
    const doubled = frames.flatMap((f) => [f, { ...f, data: new Uint8Array(f.data) }])
    const read = async (source: FrameSource) =>
      (
        await cameraEntropy({
          source,
          stride: 1,
          warmupFrames: 0,
          bits: 'lsb',
          conditioning: 'raw',
          debias: false,
        }).getBytes(1024)
      ).bytes
    expect(await read(replay(doubled))).toEqual(await read(replay(frames)))
  })

  test('lsb mode on a frozen scene starves (a duplicate carries no fresh noise)', async () => {
    const [still] = randomFrames(1, 256)
    const source: FrameSource = {
      async *frames() {
        while (true) yield still as Frame
      },
    }
    const err = (await cameraEntropy({ source, warmupFrames: 0, bits: 'lsb' })
      .getBytes(4, { timeoutMs: 80 })
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('timeout')
  })

  test('without a source and without a browser camera, fails with a remedy', async () => {
    const err = await cameraEntropy()
      .getBytes(4)
      .catch((e) => e)
    expect(err).toBeInstanceOf(EntropyError)
    expect((err as EntropyError).code).toBe('invalid_request')
    expect((err as Error).message).toContain('source')
  })

  test('a denied camera permission surfaces as permission', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException('Permission denied', 'NotAllowedError')
        },
      },
    })
    const err = (await cameraEntropy()
      .getBytes(4)
      .catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('permission')
  })
})
