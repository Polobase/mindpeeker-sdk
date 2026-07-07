import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { EntropyError } from '../errors.js'

export interface NodeSerialOptions {
  /** Serial device path, e.g. /dev/cu.usbserial-110 (macOS) or /dev/ttyUSB0 (Linux). */
  path: string
  /** Default 921_600 — the AetherOnePi ESP32 firmware rate. */
  baudRate?: number
  /** Override the stty binary (tests). */
  sttyPath?: string
}

export interface NodeSerialStream extends AsyncIterable<Uint8Array> {
  close(): void
}

/** stty argv per platform: -f (BSD/macOS) vs -F (GNU/Linux). */
export function sttyArgs(devicePath: string, baudRate: number, platform: string): string[] {
  return [platform === 'darwin' ? '-f' : '-F', devicePath, String(baudRate), 'raw', '-echo']
}

function configurePort(sttyPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(sttyPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })
    child.on('error', (error) => {
      reject(
        new EntropyError('network', `stty failed to start: ${error.message}`, {
          provider: 'serial',
          cause: error,
        }),
      )
    })
    child.on('close', (code) => {
      if (code === 0) resolve()
      else {
        reject(
          new EntropyError('network', `stty exited with ${code}: ${stderr.trim().slice(0, 200)}`, {
            provider: 'serial',
          }),
        )
      }
    })
  })
}

/**
 * Zero-npm-dependency serial reader for macOS/Linux: configures the tty via
 * stty, then streams the character device with fs.createReadStream. Windows
 * users should inject a `serialport` instance into serialEntropy instead.
 *
 *   serialEntropy({ source: await nodeSerialSource({ path }), name: 'esp32' })
 */
export async function nodeSerialSource(opts: NodeSerialOptions): Promise<NodeSerialStream> {
  const { path, baudRate = 921_600, sttyPath = 'stty' } = opts
  if (!path) throw new TypeError('nodeSerialSource({ path }) requires a device path')
  await configurePort(sttyPath, sttyArgs(path, baudRate, process.platform))
  const stream = createReadStream(path, { highWaterMark: 4096 })
  return {
    [Symbol.asyncIterator]: () => stream[Symbol.asyncIterator]() as AsyncIterator<Uint8Array>,
    close: () => {
      stream.destroy()
    },
  }
}
