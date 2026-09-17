import { afterAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EntropyError } from '../../src/errors.js'
import { ffmpegFrameSource, ffmpegVideoArgs, frameSlicer } from '../../src/node/ffmpeg-frames.js'
import { ffmpegAudioArgs, ffmpegSampleSource, int16Chunker } from '../../src/node/ffmpeg-samples.js'
import { cameraEntropy } from '../../src/providers/camera.js'
import { micEntropy } from '../../src/providers/microphone.js'

describe('ffmpegVideoArgs', () => {
  test('builds avfoundation input on darwin, cropping instead of forcing a capture size', () => {
    const args = ffmpegVideoArgs({ device: '0', width: 320, height: 240, fps: 10 }, 'darwin')
    expect(args).toContain('avfoundation')
    // cameras only support specific native modes — never pass -video_size
    expect(args).not.toContain('-video_size')
    expect(args.join(' ')).toContain('-vf crop=320:240')
    expect(args.join(' ')).toContain('-framerate 10')
    expect(args.join(' ')).toContain('-pix_fmt gray -f rawvideo')
    // without passthrough, ffmpeg duplicates frames to satisfy CFR against
    // wall-clock capture timestamps — duplicate frames diff to zero bits.
    // -vsync (not -fps_mode, FFmpeg >= 5.1 only) parses on 4.x through 8.x.
    expect(args.join(' ')).toContain('-vsync passthrough')
    expect(args).not.toContain('-fps_mode')
    expect(args[0]).toBe('-nostdin')
    expect(args.at(-1)).toBe('pipe:1')
  })

  test('omits -framerate when fps is not given (device default)', () => {
    const args = ffmpegVideoArgs({ device: '0', width: 320, height: 240 }, 'darwin')
    expect(args).not.toContain('-framerate')
  })

  test('builds v4l2 input on linux', () => {
    const args = ffmpegVideoArgs(
      { device: '/dev/video0', width: 640, height: 480, fps: 15 },
      'linux',
    )
    expect(args).toContain('v4l2')
    expect(args).toContain('/dev/video0')
    expect(args.join(' ')).toContain('-vf crop=640:480')
  })
})

describe('ffmpegAudioArgs', () => {
  test('builds avfoundation audio input on darwin', () => {
    const args = ffmpegAudioArgs({ device: ':0', sampleRate: 48_000 }, 'darwin')
    expect(args).toContain('avfoundation')
    expect(args).toContain(':0')
    expect(args.join(' ')).toContain('-f s16le')
    expect(args[0]).toBe('-nostdin')
  })

  test('builds alsa input on linux', () => {
    const args = ffmpegAudioArgs({ device: 'default', sampleRate: 44_100 }, 'linux')
    expect(args).toContain('alsa')
    expect(args).toContain('44100')
  })
})

describe('frameSlicer', () => {
  test('assembles frames across chunk boundaries', () => {
    const slice = frameSlicer(4)
    expect(slice(new Uint8Array([1, 2]))).toEqual([])
    expect(slice(new Uint8Array([3, 4, 5]))).toEqual([new Uint8Array([1, 2, 3, 4])])
    expect(slice(new Uint8Array([6, 7, 8, 9]))).toEqual([new Uint8Array([5, 6, 7, 8])])
  })

  test('emits several frames from one large chunk', () => {
    const slice = frameSlicer(2)
    expect(slice(new Uint8Array([1, 2, 3, 4, 5]))).toEqual([
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4]),
    ])
    expect(slice(new Uint8Array([6]))).toEqual([new Uint8Array([5, 6])])
  })
})

describe('int16Chunker', () => {
  test('decodes little-endian pairs and carries odd bytes', () => {
    const chunk = int16Chunker()
    expect(Array.from(chunk(new Uint8Array([1])))).toEqual([])
    // carried 0x01 + [0x00, 0x02, 0x00] → LE pairs [0x0001, 0x0002]
    expect(Array.from(chunk(new Uint8Array([0, 2, 0])))).toEqual([1, 2])
  })

  test('decodes negative values', () => {
    const chunk = int16Chunker()
    expect(Array.from(chunk(new Uint8Array([0xff, 0xff])))).toEqual([-1])
  })
})

/**
 * A stand-in for a stalled ffmpeg (camera permission prompt pending, hung
 * v4l2 driver): records its pid, then produces no output for 30 s.
 */
const dir = mkdtempSync(join(tmpdir(), 'entropy-ffmpeg-'))
const stalled = join(dir, 'stalled-ffmpeg.sh')
writeFileSync(stalled, `#!/bin/sh\necho $$ > "${dir}/pid-$$"\nexec sleep 30\n`)
chmodSync(stalled, 0o755)
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitFor(predicate: () => boolean, ms = 2000): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, 10))
  }
  return predicate()
}

function spawnedPids(): number[] {
  return readdirSync(dir)
    .filter((f) => f.startsWith('pid-'))
    .map((f) => Number(readFileSync(join(dir, f), 'utf8').trim()))
}

describe('ffmpeg adapters release a stalled child on abort/timeout', () => {
  test('frames(): an abort kills the child at once and rejects with aborted', async () => {
    const before = new Set(spawnedPids())
    const controller = new AbortController()
    const frames = ffmpegFrameSource({ device: '0', ffmpegPath: stalled })
      .frames(controller.signal)
      [Symbol.asyncIterator]()
    const pending = frames.next()
    expect(await waitFor(() => spawnedPids().some((p) => !before.has(p)))).toBe(true)
    const pid = spawnedPids().find((p) => !before.has(p)) as number
    expect(alive(pid)).toBe(true)
    controller.abort()
    const err = (await pending.catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('aborted')
    expect(await waitFor(() => !alive(pid))).toBe(true)
  })

  test('cameraEntropy getBytes timeout kills the stalled capture child', async () => {
    const before = new Set(spawnedPids())
    const provider = cameraEntropy({
      source: ffmpegFrameSource({ device: '0', ffmpegPath: stalled }),
    })
    const err = (await provider.getBytes(32, { timeoutMs: 300 }).catch((e) => e)) as EntropyError
    expect(err.code).toBe('timeout')
    const pid = spawnedPids().find((p) => !before.has(p)) as number
    expect(pid).toBeGreaterThan(0)
    expect(await waitFor(() => !alive(pid))).toBe(true)
  })

  test('micEntropy getBytes abort kills the stalled capture child', async () => {
    const before = new Set(spawnedPids())
    const controller = new AbortController()
    const provider = micEntropy({
      source: ffmpegSampleSource({ device: ':0', ffmpegPath: stalled }),
    })
    const pending = provider.getBytes(32, { signal: controller.signal })
    expect(await waitFor(() => spawnedPids().some((p) => !before.has(p)))).toBe(true)
    controller.abort()
    const err = (await pending.catch((e) => e)) as EntropyError
    expect(err.code).toBe('aborted')
    const pid = spawnedPids().find((p) => !before.has(p)) as number
    expect(await waitFor(() => !alive(pid))).toBe(true)
  })

  test('a pre-aborted session never spawns', async () => {
    const before = spawnedPids().length
    const err = (await ffmpegSampleSource({ device: ':0', ffmpegPath: stalled })
      .samples(AbortSignal.abort())
      [Symbol.asyncIterator]()
      .next()
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('aborted')
    expect(spawnedPids().length).toBe(before)
  })

  test('a missing device option is invalid_request', () => {
    expect(() => ffmpegFrameSource({ device: '' })).toThrow(EntropyError)
    expect(() => ffmpegSampleSource({ device: '' })).toThrow(EntropyError)
  })

  test('an ffmpeg that exits reports network with its stderr tail', async () => {
    const failing = join(dir, 'failing-ffmpeg.sh')
    writeFileSync(failing, '#!/bin/sh\necho "Unrecognized option vsync" >&2\nexit 1\n')
    chmodSync(failing, 0o755)
    const err = (await ffmpegFrameSource({ device: '0', ffmpegPath: failing })
      .frames()
      [Symbol.asyncIterator]()
      .next()
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('network')
    expect(err.message).toContain('Unrecognized option vsync')
  })
})
