import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import {
  cameraEntropy,
  type Frame,
  type FrameSource,
  lsbBits,
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
})

describe('lsbBits', () => {
  test('extracts pixel LSBs with stride', () => {
    expect(lsbBits(gray([2, 3, 5, 4]), 1)).toEqual([0, 1, 1, 0])
    expect(lsbBits(gray([2, 3, 5, 4]), 2)).toEqual([0, 1])
  })
})

providerContract(
  'cameraEntropy (scripted frames)',
  () => cameraEntropy({ source: prngFrames(), stride: 1, warmupFrames: 0 }),
  { kind: 'trng', privacy: 'private', lengths: [1, 16, 64] },
)

describe('cameraEntropy', () => {
  test('is named camera; raw mode is camera(raw)', () => {
    expect(cameraEntropy({ source: prngFrames() }).name).toBe('camera')
    expect(cameraEntropy({ source: prngFrames(), conditioning: 'raw' }).name).toBe('camera(raw)')
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
    let level = 0
    const source: FrameSource = {
      async *frames() {
        while (true) yield gray(new Array(8).fill(level++))
      },
    }
    const { bytes } = await cameraEntropy({
      source,
      stride: 1,
      warmupFrames: 2,
      conditioning: 'raw',
      debias: false, // keep the raw monotone pattern visible
    }).getBytes(1)
    // every post-warmup frame is brighter everywhere → all sign bits 1
    expect(bytes).toEqual(new Uint8Array([0xff]))
  })

  test('debias runs von Neumann over the sign bits', async () => {
    // pixel pattern alternates direction → bits 1,0,1,0… → VN pairs (1,0) → all 1s
    const frames = [
      gray([0, 9, 0, 9, 0, 9, 0, 9, 0, 9, 0, 9, 0, 9, 0, 9]),
      gray([5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]),
    ]
    const source: FrameSource = {
      async *frames() {
        yield* frames
        while (true) yield frames[1] as Frame
      },
    }
    const { bytes } = await cameraEntropy({
      source,
      stride: 1,
      warmupFrames: 0,
      debias: true,
      conditioning: 'raw',
    })
      .getBytes(1, { timeoutMs: 500 })
      .catch(() => ({ bytes: new Uint8Array([0]) }))
    // 16 alternating bits → 8 von Neumann bits, all 1
    expect(bytes).toEqual(new Uint8Array([0xff]))
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

  test('lsb mode extracts without needing frame pairs', async () => {
    const source: FrameSource = {
      async *frames() {
        while (true) yield gray([3, 2, 3, 2, 3, 2, 3, 2]) // LSBs 1,0,1,0…
      },
    }
    const { bytes } = await cameraEntropy({
      source,
      stride: 1,
      warmupFrames: 0,
      bits: 'lsb',
      conditioning: 'raw',
      debias: false,
      // constant LSB pattern would eventually trip health tests on longer
      // reads; one byte stays under the cutoffs
    }).getBytes(1)
    expect(bytes).toEqual(new Uint8Array([0b10101010]))
  })

  test('without a source and without a browser camera, fails with a remedy', async () => {
    const err = await cameraEntropy()
      .getBytes(4)
      .catch((e) => e)
    expect(err).toBeInstanceOf(TypeError)
    expect((err as Error).message).toContain('source')
  })
})
