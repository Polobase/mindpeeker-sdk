import { packBits } from '../internal/bits.js'
import type { ConditioningOptions } from '../internal/condition.js'
import { sampledProvider } from '../internal/sampled.js'
import type { EntropyProvider } from '../types.js'

export interface SampleSource {
  /** A fresh PCM sample iterable per session; stop capturing in the generator's finally. */
  samples(signal?: AbortSignal): AsyncIterable<Float32Array | Int16Array>
  close?(): void | Promise<void>
}

export interface MicrophoneOptions extends ConditioningOptions {
  /** Injected PCM samples (Node, tests). Default: getUserMedia audio (browser only). */
  source?: SampleSource
  /** LSBs kept per 16-bit sample. Default 1. */
  bitsPerSample?: 1 | 2 | 4
  /** Audio discarded at session start. Default 200. */
  warmupMs?: number
  /** Used to convert warmupMs into a sample count. Default 48_000. */
  sampleRate?: number
}

/** Extract the lowest `bitsPerSample` bits of each sample (Float32 scaled to int16 first). */
export function sampleLsbBits(
  samples: Float32Array | Int16Array,
  bitsPerSample: 1 | 2 | 4,
): number[] {
  const isFloat = samples instanceof Float32Array
  const bits: number[] = []
  for (let i = 0; i < samples.length; i++) {
    let value = samples[i] as number
    if (isFloat) {
      value = Math.round(Math.max(-1, Math.min(1, value)) * 32_767)
    }
    for (let b = bitsPerSample - 1; b >= 0; b--) {
      bits.push((value >> b) & 1)
    }
  }
  return bits
}

const CAPTURE_BUFFER_SAMPLES = 4096

function browserSampleSource(): SampleSource {
  return {
    async *samples(signal?: AbortSignal) {
      const mediaDevices = (globalThis as { navigator?: Navigator }).navigator?.mediaDevices
      if (typeof mediaDevices?.getUserMedia !== 'function') {
        throw new TypeError(
          'micEntropy: no microphone in this runtime — pass a { source } (in Node: ffmpegSampleSource from @mindpeeker/entropy/node)',
        )
      }
      // Disable all DSP the platform lets us disable; browsers do not always
      // honor these, which is exactly what the health tests guard against.
      const stream = await mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
      const AudioContextCtor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
      if (!AudioContextCtor) {
        for (const track of stream.getTracks()) track.stop()
        throw new TypeError('micEntropy: AudioContext unavailable in this runtime')
      }
      const context = new AudioContextCtor()
      const queue: Float32Array[] = []
      let notify: (() => void) | null = null
      const push = (chunk: Float32Array) => {
        queue.push(chunk)
        notify?.()
      }
      const sourceNode = context.createMediaStreamSource(stream)
      // ScriptProcessorNode is deprecated but universal and asset-free; an
      // AudioWorklet would need a module URL. Entropy harvesting does not
      // care about the latency drawbacks.
      const processor = context.createScriptProcessor(CAPTURE_BUFFER_SAMPLES, 1, 1)
      processor.onaudioprocess = (event) => {
        push(new Float32Array(event.inputBuffer.getChannelData(0)))
      }
      sourceNode.connect(processor)
      processor.connect(context.destination)
      try {
        while (true) {
          if (signal?.aborted) throw signal.reason
          const chunk = queue.shift()
          if (chunk) {
            yield chunk
          } else {
            await new Promise<void>((resolve) => {
              notify = resolve
            })
            notify = null
          }
        }
      } finally {
        processor.disconnect()
        sourceNode.disconnect()
        for (const track of stream.getTracks()) track.stop()
        await context.close().catch(() => {})
      }
    },
  }
}

/**
 * Microphone ADC noise — the least significant bits of the audio samples.
 * MEMS microphones and browser DSP can interfere; keep expectations modest
 * and rely on the health tests to catch dead or processed inputs.
 */
export function micEntropy(opts: MicrophoneOptions = {}): EntropyProvider {
  const { bitsPerSample = 1, warmupMs = 200, sampleRate = 48_000 } = opts
  const source = opts.source ?? browserSampleSource()
  const warmupSamples = Math.ceil((warmupMs / 1000) * sampleRate)

  async function* open(signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    let skipped = 0
    let leftover: number[] = []
    for await (let chunk of source.samples(signal)) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('aborted', 'AbortError')
      if (skipped < warmupSamples) {
        const need = warmupSamples - skipped
        if (chunk.length <= need) {
          skipped += chunk.length
          continue
        }
        skipped = warmupSamples
        chunk = chunk.slice(need) as Float32Array | Int16Array
      }
      const [bytes, rest] = packBits(leftover.concat(sampleLsbBits(chunk, bitsPerSample)))
      leftover = rest
      if (bytes.length > 0) yield bytes
    }
  }

  return sampledProvider(
    {
      name: 'microphone',
      kind: 'trng',
      privacy: 'private',
      open,
      defaultMinEntropyPerSample: 2,
      defaultSafetyFactor: 4,
      defaultTimeoutMs: 30_000, // permission prompt + warmup
    },
    opts,
  )
}
