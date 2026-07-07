import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { EntropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'
import type { Frame, FrameSource } from '../providers/camera.js'

export interface FfmpegFrameOptions {
  /** avfoundation index on macOS (e.g. '0'), v4l2 device on Linux (e.g. '/dev/video0'). */
  device: string
  width?: number
  height?: number
  /** Capture framerate; omit to use the device default. */
  fps?: number
  ffmpegPath?: string
}

interface VideoArgsInput {
  device: string
  width: number
  height: number
  fps?: number
}

export function ffmpegVideoArgs(opts: VideoArgsInput, platform: string): string[] {
  const { device, width, height, fps } = opts
  // Cameras only accept specific native modes, so capture at the device
  // default and CROP a center region: scaling would average pixels and
  // smooth away the very sensor noise we harvest.
  const framerate = fps !== undefined ? ['-framerate', String(fps)] : []
  const input =
    platform === 'darwin'
      ? ['-f', 'avfoundation', ...framerate, '-i', device]
      : ['-f', 'v4l2', ...framerate, '-i', device]
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    ...input,
    '-vf',
    `crop=${width}:${height}`,
    '-pix_fmt',
    'gray',
    '-f',
    'rawvideo',
    // write each captured frame exactly once — the default rate sync
    // duplicates frames massively against avfoundation wall-clock timestamps
    '-fps_mode',
    'passthrough',
    '-an',
    'pipe:1',
  ]
}

/** Stateful slicer: raw byte chunks in, complete fixed-size frames out. */
export function frameSlicer(frameBytes: number): (chunk: Uint8Array) => Uint8Array[] {
  let pending: Uint8Array[] = []
  let size = 0
  return (chunk) => {
    pending.push(chunk)
    size += chunk.length
    if (size < frameBytes) return []
    let all = concatBytes(pending)
    const frames: Uint8Array[] = []
    while (all.length >= frameBytes) {
      frames.push(all.slice(0, frameBytes))
      all = all.slice(frameBytes)
    }
    pending = all.length > 0 ? [all] : []
    size = all.length
    return frames
  }
}

/**
 * Camera frames for Node via ffmpeg (must be on PATH or given via
 * ffmpegPath): grayscale rawvideo piped from avfoundation (macOS) or v4l2
 * (Linux). Plug into cameraEntropy({ source: ffmpegFrameSource({...}) }).
 */
export function ffmpegFrameSource(opts: FfmpegFrameOptions): FrameSource {
  // avfoundation defaults to 29.97 fps, which most cameras reject — they
  // support exact modes like 15/30. Default to 30 on macOS; v4l2 negotiates.
  const defaultFps = process.platform === 'darwin' ? 30 : undefined
  const { device, width = 640, height = 480, fps = defaultFps, ffmpegPath = 'ffmpeg' } = opts
  if (!device) throw new TypeError('ffmpegFrameSource({ device }) requires a capture device')

  return {
    async *frames(signal?: AbortSignal): AsyncGenerator<Frame> {
      const child = spawn(
        ffmpegPath,
        ffmpegVideoArgs({ device, width, height, fps }, process.platform),
        {
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      let stderr = ''
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })
      try {
        await once(child, 'spawn')
      } catch (error) {
        throw new EntropyError('network', `ffmpeg failed to start: ${(error as Error).message}`, {
          provider: 'camera',
          cause: error,
        })
      }
      const slice = frameSlicer(width * height)
      try {
        for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
          if (signal?.aborted) throw signal.reason ?? new DOMException('aborted', 'AbortError')
          for (const data of slice(new Uint8Array(chunk))) {
            yield { width, height, data, channels: 1 }
          }
        }
        throw new EntropyError('network', `ffmpeg exited: ${stderr.trim().slice(0, 300)}`, {
          provider: 'camera',
        })
      } finally {
        child.kill('SIGKILL')
      }
    },
  }
}
