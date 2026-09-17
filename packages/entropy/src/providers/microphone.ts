import { EntropyError } from '../errors.js'
import { packBits } from '../internal/bits.js'
import type { ConditioningOptions } from '../internal/condition.js'
import { requireFinite, requireInteger } from '../internal/options.js'
import {
  DEFAULT_QUEUE_LIMIT,
  DropOldestQueue,
  permissionError,
  starvationGuard,
} from '../internal/queue.js'
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
  /** LSBs kept per 16-bit sample: 1, 2 or 4. Default 1. */
  bitsPerSample?: 1 | 2 | 4
  /** Audio discarded at session start (finite, ≥ 0). Default 200. */
  warmupMs?: number
  /** Used to convert warmupMs into a sample count (finite, > 0). Default 48_000. */
  sampleRate?: number
  /**
   * Browser capture only: audio buffers held while the consumer is busy
   * (integer ≥ 1); the oldest is dropped beyond it. Default 8.
   */
  queueLimit?: number
}

/**
 * Extract the lowest `bitsPerSample` bits of each sample. Float32 samples are
 * first rescaled to int16 by ×32768 (clamped to [−32768, 32767]) — the exact
 * inverse of the int16/32768 conversion audio stacks apply, so the original
 * ADC word's low bits are recovered bit-exactly.
 */
export function sampleLsbBits(
  samples: Float32Array | Int16Array,
  bitsPerSample: 1 | 2 | 4,
): number[] {
  const isFloat = samples instanceof Float32Array
  const bits: number[] = []
  for (let i = 0; i < samples.length; i++) {
    let value = samples[i] as number
    if (isFloat) {
      value = Math.max(-32_768, Math.min(32_767, Math.round(value * 32_768)))
    }
    for (let b = bitsPerSample - 1; b >= 0; b--) {
      bits.push((value >> b) & 1)
    }
  }
  return bits
}

const CAPTURE_BUFFER_SAMPLES = 4096

/**
 * getUserMedia + ScriptProcessor capture (browser only). Exported for tests;
 * `micEntropy()` uses it when no `source` is given.
 */
export function browserSampleSource(queueLimit: number = DEFAULT_QUEUE_LIMIT): SampleSource {
  return {
    async *samples(signal?: AbortSignal) {
      const mediaDevices = (globalThis as { navigator?: Navigator }).navigator?.mediaDevices
      if (typeof mediaDevices?.getUserMedia !== 'function') {
        throw new EntropyError(
          'invalid_request',
          'micEntropy: no microphone in this runtime — pass a { source } (in Node: ffmpegSampleSource from @mindpeeker/entropy/node)',
          { provider: 'microphone' },
        )
      }
      const AudioContextCtor = (globalThis as { AudioContext?: typeof AudioContext }).AudioContext
      if (!AudioContextCtor) {
        throw new EntropyError(
          'invalid_request',
          'micEntropy: AudioContext unavailable in this runtime',
          { provider: 'microphone' },
        )
      }
      // Disable all DSP the platform lets us disable; browsers do not always
      // honor these, which is exactly what the health tests guard against.
      let stream: MediaStream
      try {
        stream = await mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        })
      } catch (error) {
        throw permissionError(error, 'microphone', 'microphone')
      }
      const context = new AudioContextCtor()
      const queue = new DropOldestQueue<Float32Array>(queueLimit, 'microphone')
      const sourceNode = context.createMediaStreamSource(stream)
      // ScriptProcessorNode is deprecated but universal and asset-free; an
      // AudioWorklet would need a module URL. Entropy harvesting does not
      // care about the latency drawbacks.
      const processor = context.createScriptProcessor(CAPTURE_BUFFER_SAMPLES, 1, 1)
      processor.onaudioprocess = (event) => {
        queue.push(new Float32Array(event.inputBuffer.getChannelData(0)))
      }
      sourceNode.connect(processor)
      processor.connect(context.destination)
      try {
        while (true) yield await queue.take(signal)
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
 *
 * Throws `EntropyError('invalid_request')` at construction for an invalid
 * `bitsPerSample`, `warmupMs`, `sampleRate`, `queueLimit` or conditioning option.
 */
export function micEntropy(opts: MicrophoneOptions = {}): EntropyProvider {
  const bitsPerSample = opts.bitsPerSample ?? 1
  if (bitsPerSample !== 1 && bitsPerSample !== 2 && bitsPerSample !== 4) {
    throw new EntropyError(
      'invalid_request',
      `bitsPerSample must be 1, 2 or 4, got ${String(bitsPerSample)}`,
      { provider: 'microphone' },
    )
  }
  const warmupMs = requireFinite(opts.warmupMs ?? 200, 'warmupMs', { min: 0 }, 'microphone')
  const sampleRate = requireFinite(
    opts.sampleRate ?? 48_000,
    'sampleRate',
    { min: 0, minExclusive: true },
    'microphone',
  )
  const queueLimit = requireInteger(
    opts.queueLimit ?? DEFAULT_QUEUE_LIMIT,
    'queueLimit',
    1,
    'microphone',
  )
  const source = opts.source ?? browserSampleSource(queueLimit)
  const warmupSamples = Math.ceil((warmupMs / 1000) * sampleRate)

  async function* open(signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    let skipped = 0
    let leftover: number[] = []
    const tick = starvationGuard(signal)
    for await (let chunk of source.samples(signal)) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('aborted', 'AbortError')
      if (skipped < warmupSamples) {
        const need = warmupSamples - skipped
        if (chunk.length <= need) {
          skipped += chunk.length
          await tick(false)
          continue
        }
        skipped = warmupSamples
        chunk = chunk.slice(need) as Float32Array | Int16Array
      }
      const [bytes, rest] = packBits(leftover.concat(sampleLsbBits(chunk, bitsPerSample)))
      leftover = rest
      if (bytes.length > 0) yield bytes
      await tick(bytes.length > 0)
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
