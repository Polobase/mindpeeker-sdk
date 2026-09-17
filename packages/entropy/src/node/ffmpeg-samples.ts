import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { EntropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'
import type { SampleSource } from '../providers/microphone.js'
import { killOnAbort, stderrTail } from './child.js'

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

/** ffmpeg argv for mono s16le capture (`-nostdin`: never read the terminal). */
export function ffmpegAudioArgs(opts: AudioArgsInput, platform: string): string[] {
  const { device, sampleRate } = opts
  const input =
    platform === 'darwin' ? ['-f', 'avfoundation', '-i', device] : ['-f', 'alsa', '-i', device]
  return [
    '-nostdin',
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
 *
 * The capture child is SIGKILLed as soon as the session's signal aborts
 * (timeout or caller abort) — even while ffmpeg produces no output — and when
 * the session ends. Failures surface as `EntropyError` (`network` for spawn
 * errors and unexpected exits, `aborted` after an abort).
 */
export function ffmpegSampleSource(opts: FfmpegSampleOptions): SampleSource {
  const { device, sampleRate = 48_000, ffmpegPath = 'ffmpeg' } = opts
  if (!device) {
    throw new EntropyError(
      'invalid_request',
      'ffmpegSampleSource({ device }) requires a capture device',
      { provider: 'microphone' },
    )
  }

  return {
    async *samples(signal?: AbortSignal): AsyncGenerator<Int16Array> {
      if (signal?.aborted) {
        throw new EntropyError('aborted', 'microphone capture aborted before start', {
          provider: 'microphone',
          cause: signal.reason,
        })
      }
      const child = spawn(ffmpegPath, ffmpegAudioArgs({ device, sampleRate }, process.platform), {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const stderr = stderrTail(child)
      const unsubscribe = killOnAbort(child, signal)
      try {
        try {
          await once(child, 'spawn')
        } catch (error) {
          throw new EntropyError('network', `ffmpeg failed to start: ${(error as Error).message}`, {
            provider: 'microphone',
            cause: error,
          })
        }
        // post-spawn 'error' events (e.g. a failed kill) must not crash the process
        child.on('error', () => {})
        const decode = int16Chunker()
        try {
          for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
            if (signal?.aborted) break
            const samples = decode(new Uint8Array(chunk))
            if (samples.length > 0) yield samples
          }
        } catch (error) {
          if (error instanceof EntropyError) throw error
          if (!signal?.aborted) {
            throw new EntropyError('network', `ffmpeg read failed: ${(error as Error).message}`, {
              provider: 'microphone',
              cause: error,
            })
          }
        }
        if (signal?.aborted) {
          throw new EntropyError('aborted', 'microphone capture aborted', {
            provider: 'microphone',
            cause: signal.reason,
          })
        }
        throw new EntropyError('network', `ffmpeg exited: ${stderr().slice(-300)}`, {
          provider: 'microphone',
        })
      } finally {
        unsubscribe()
        child.kill('SIGKILL')
      }
    },
  }
}
