import { describe, expect, test } from 'bun:test'
import { ffmpegVideoArgs, frameSlicer } from '../../src/node/ffmpeg-frames.js'
import { ffmpegAudioArgs, int16Chunker } from '../../src/node/ffmpeg-samples.js'

describe('ffmpegVideoArgs', () => {
  test('builds avfoundation input on darwin, scaling instead of forcing a capture size', () => {
    const args = ffmpegVideoArgs({ device: '0', width: 320, height: 240, fps: 10 }, 'darwin')
    expect(args).toContain('avfoundation')
    // cameras only support specific native modes — never pass -video_size
    expect(args).not.toContain('-video_size')
    expect(args.join(' ')).toContain('-vf crop=320:240')
    expect(args.join(' ')).toContain('-framerate 10')
    expect(args.join(' ')).toContain('-pix_fmt gray -f rawvideo')
    // without passthrough, ffmpeg duplicates frames to satisfy CFR against
    // wall-clock capture timestamps — duplicate frames diff to zero bits
    expect(args.join(' ')).toContain('-fps_mode passthrough')
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
