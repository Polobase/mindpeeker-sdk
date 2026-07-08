import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { EntropyError } from '../errors.js'

export interface RtlSdrOptions {
  /** Tuned frequency in Hz. Default 70 MHz — quiet spectrum, away from broadcast bands. */
  frequencyHz?: number
  /** Default 2_400_000 (2.4 MS/s — higher rates drop USB samples). */
  sampleRate?: number
  /** Manual tuner gain in dB. Default 49.6 (R820T max) — NEVER auto/AGC, which
   * external transmitters modulate. */
  gain?: number
  deviceIndex?: number
  rtlSdrPath?: string
}

export interface RtlSdrStream extends AsyncIterable<Uint8Array> {
  close(): void
}

export function rtlSdrArgs(opts: {
  frequencyHz: number
  sampleRate: number
  gain: number
  deviceIndex: number
}): string[] {
  return [
    '-f',
    String(opts.frequencyHz),
    '-s',
    String(opts.sampleRate),
    '-g',
    String(opts.gain),
    '-d',
    String(opts.deviceIndex),
    '-', // raw interleaved uint8 IQ to stdout
  ]
}

/**
 * Spawn `rtl_sdr` and stream its raw IQ bytes. Needs the rtl-sdr CLI tools
 * (apt install rtl-sdr / brew install librtlsdr) and a dongle. RTL-SDR Blog
 * V4 dongles require the rtlsdrblog driver fork — stock librtlsdr silently
 * produces corrupted output on V4, which is exactly why sdrEntropy runs
 * health tests on the raw stream.
 *
 *   sdrEntropy({ source: await rtlSdrSource() })
 */
export async function rtlSdrSource(opts: RtlSdrOptions = {}): Promise<RtlSdrStream> {
  const {
    frequencyHz = 70_000_000,
    sampleRate = 2_400_000,
    gain = 49.6,
    deviceIndex = 0,
    rtlSdrPath = 'rtl_sdr',
  } = opts

  const child = spawn(rtlSdrPath, rtlSdrArgs({ frequencyHz, sampleRate, gain, deviceIndex }), {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr?.on('data', (data: Buffer) => {
    stderr += data.toString()
  })
  try {
    await once(child, 'spawn')
  } catch (error) {
    throw new EntropyError('network', `rtl_sdr failed to start: ${(error as Error).message}`, {
      provider: 'sdr',
      cause: error,
    })
  }

  let closedByUs = false
  return {
    async *[Symbol.asyncIterator]() {
      for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
        yield new Uint8Array(chunk)
      }
      if (!closedByUs) {
        // the dongle stream must never end on its own
        throw new EntropyError('network', `rtl_sdr exited: ${stderr.trim().slice(0, 300)}`, {
          provider: 'sdr',
        })
      }
    },
    close: () => {
      closedByUs = true
      child.kill('SIGKILL')
    },
  }
}
