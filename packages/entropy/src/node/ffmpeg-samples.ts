import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { EntropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'
import type { SampleSource } from '../providers/microphone.js'

export interface FfmpegSampleOptions {
  /** avfoundation audio spec on macOS (e.g. ':0'), alsa device on Linux (e.g. 'default'). */
  device: string
  sampleRate?: number
  ffmpegPath?: string
}

interface AudioArgsInput {
  device: string
  sampleRate: number
}

export function ffmpegAudioArgs(opts: AudioArgsInput, platform: string): string[] {
  const { device, sampleRate } = opts
  const input =
    platform === 'darwin' ? ['-f', 'avfoundation', '-i', device] : ['-f', 'alsa', '-i', device]
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    ...input,
    '-ar',
    String(sampleRate),
    '-ac',
    '1',
    '-f',
    's16le',
    'pipe:1',
  ]
}

/** Stateful little-endian int16 decoder that carries odd trailing bytes. */
export function int16Chunker(): (chunk: Uint8Array) => Int16Array {
  let carry: Uint8Array | null = null
  return (chunk) => {
    const bytes = carry ? concatBytes([carry, chunk]) : chunk
    const even = bytes.length - (bytes.length % 2)
    carry = bytes.length % 2 === 1 ? bytes.slice(even) : null
    const out = new Int16Array(even / 2)
    const view = new DataView(bytes.buffer, bytes.byteOffset, even)
    for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true)
    return out
  }
}

/**
 * Microphone PCM for Node via ffmpeg: mono s16le piped from avfoundation
 * (macOS) or alsa (Linux). Plug into micEntropy({ source: ffmpegSampleSource({...}) }).
 */
export function ffmpegSampleSource(opts: FfmpegSampleOptions): SampleSource {
  const { device, sampleRate = 48_000, ffmpegPath = 'ffmpeg' } = opts
  if (!device) throw new TypeError('ffmpegSampleSource({ device }) requires a capture device')

  return {
    async *samples(signal?: AbortSignal): AsyncGenerator<Int16Array> {
      const child = spawn(ffmpegPath, ffmpegAudioArgs({ device, sampleRate }, process.platform), {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let stderr = ''
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })
      try {
        await once(child, 'spawn')
      } catch (error) {
        throw new EntropyError('network', `ffmpeg failed to start: ${(error as Error).message}`, {
          provider: 'microphone',
          cause: error,
        })
      }
      const decode = int16Chunker()
      try {
        for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
          if (signal?.aborted) throw signal.reason ?? new DOMException('aborted', 'AbortError')
          const samples = decode(new Uint8Array(chunk))
          if (samples.length > 0) yield samples
        }
        throw new EntropyError('network', `ffmpeg exited: ${stderr.trim().slice(0, 300)}`, {
          provider: 'microphone',
        })
      } finally {
        child.kill('SIGKILL')
      }
    },
  }
}
