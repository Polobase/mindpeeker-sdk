import { spawn } from 'node:child_process'
import { constants, type ReadStream } from 'node:fs'
import { open } from 'node:fs/promises'
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

/**
 * stty argv per platform (-f BSD/macOS, -F GNU/Linux): raw 8N1 without echo,
 * hardware flow control or modem-control dependence — `clocal` keeps a port
 * with an unwired DCD line readable, `cs8 -parenb -cstopb -crtscts` pins the
 * framing instead of inheriting whatever the last user left configured.
 */
export function sttyArgs(devicePath: string, baudRate: number, platform: string): string[] {
  return [
    platform === 'darwin' ? '-f' : '-F',
    devicePath,
    String(baudRate),
    'raw',
    '-echo',
    'clocal',
    'cs8',
    '-parenb',
    '-cstopb',
    '-crtscts',
  ]
}

function configurePort(sttyPath: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(sttyPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr?.on('data', (data: Buffer) => {
      stderr = (stderr + data.toString()).slice(-1024)
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

/** Map an fs error on the serial device to `EntropyError('network')` with the original as cause. */
function deviceError(error: unknown, path: string, action: string): EntropyError {
  if (error instanceof EntropyError) return error
  const code = (error as NodeJS.ErrnoException | null)?.code
  const hint =
    code === 'ENOENT'
      ? ' — no such device (unplugged, or wrong path?)'
      : code === 'EACCES' || code === 'EPERM'
        ? ' — permission denied (add your user to the dialout/uucp group)'
        : code === 'EBUSY'
          ? ' — the port is in use by another process'
          : ''
  return new EntropyError(
    'network',
    `${action} ${path} failed: ${(error as Error)?.message}${hint}`,
    { provider: 'serial', cause: error },
  )
}

async function* readDevice(stream: ReadStream, path: string): AsyncGenerator<Uint8Array> {
  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      yield new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    }
  } catch (error) {
    throw deviceError(error, path, 'reading')
  }
}

/**
 * Zero-npm-dependency serial reader for macOS/Linux: opens the tty with
 * O_RDONLY | O_NOCTTY (a daemon never acquires the port as its controlling
 * terminal, so an unplug cannot SIGHUP it), configures it via stty (raw 8N1,
 * `clocal`), then streams the character device. Windows users should inject
 * a `serialport` instance into serialEntropy instead.
 *
 * Open, stty and read failures surface as `EntropyError('network')` with the
 * original error as `cause`; a missing `path` throws `invalid_request`.
 *
 *   serialEntropy({ source: await nodeSerialSource({ path }), name: 'esp32' })
 */
export async function nodeSerialSource(opts: NodeSerialOptions): Promise<NodeSerialStream> {
  const { path, baudRate = 921_600, sttyPath = 'stty' } = opts ?? ({} as NodeSerialOptions)
  if (typeof path !== 'string' || path.length === 0) {
    throw new EntropyError('invalid_request', 'nodeSerialSource({ path }) requires a device path', {
      provider: 'serial',
    })
  }
  if (!(Number.isSafeInteger(baudRate) && baudRate >= 1)) {
    throw new EntropyError(
      'invalid_request',
      `nodeSerialSource: baudRate must be an integer >= 1, got ${String(baudRate)}`,
      { provider: 'serial' },
    )
  }
  // Open our fd BEFORE running stty: tty settings reset when the last file
  // descriptor closes (stty's own), which would silently drop the port back
  // to 9600 baud. Holding the fd open keeps the configuration applied.
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOCTTY ?? 0))
  } catch (error) {
    throw deviceError(error, path, 'opening')
  }
  const stream = handle.createReadStream({ highWaterMark: 4096 })
  try {
    await configurePort(sttyPath, sttyArgs(path, baudRate, process.platform))
  } catch (error) {
    stream.destroy()
    throw error
  }
  return {
    [Symbol.asyncIterator]: () => readDevice(stream, path),
    close: () => {
      stream.destroy()
    },
  }
}
