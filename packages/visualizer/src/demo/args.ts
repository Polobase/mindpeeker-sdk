/**
 * Command-line parsing for the `mindpeeker-viz` demo. Pure: never prints,
 * never exits, never touches a file or device.
 */
import { VisualizerError } from '../errors.js'
import type { SourceOptions } from '../sources.js'

/** What the live demo serves and reads. */
export interface DemoOptions {
  readonly port: number
  readonly host: string
  readonly source: string
  readonly sourceOpts: SourceOptions
  /** `--record`: path of a new JSONL file receiving the hash-chained trials. */
  readonly record?: string
}

/** What a `--replay` run serves. */
export interface ReplayOptions {
  readonly port: number
  readonly host: string
  /** `--replay`: path of a psi schema-v2 recording to verify and play. */
  readonly replay: string
}

/** Result of {@link parseArgs}: run live, replay a recording, or print help / the source list. */
export type DemoCommand =
  | { readonly command: 'run'; readonly options: DemoOptions }
  | { readonly command: 'replay'; readonly options: ReplayOptions }
  | { readonly command: 'help' }
  | { readonly command: 'list-sources' }

/** CLI usage text. */
export const USAGE = `usage: mindpeeker-viz [options]

  --source <name>       entropy source (default: crypto); see --list-sources
  --raw                 pass hardware raw samples through, skip SHA-256 conditioning
  --serial-path <path>  serial/esp32 device (default: /dev/cu.usbserial-110 or /dev/ttyUSB0)
  --baud <n>            serial baud rate, a positive integer (default: 921600)
  --camera-device <id>  ffmpeg camera device (default: '0' macOS / '/dev/video0' Linux)
  --mic-device <spec>   ffmpeg audio device (default: ':0' macOS / 'default' Linux)
  --hwrng-path <path>   kernel hwrng device (default: /dev/hwrng)
  --record <file>       write the trials as a hash-chained psi JSONL v2 recording
                        (a new file; an existing file is never overwritten)
  --replay <file>       verify a recording's hash chain and drive the trial panels
                        from it (no live source; refuses a broken chain)
  --port <n>            HTTP/WS port, 0-65535 (default: 0 = ephemeral)
  --host <h>            bind host (default: localhost)
  --list-sources        print the available entropy sources and exit
  -h, --help            print this help and exit`

function optionsError(message: string): VisualizerError {
  return new VisualizerError('invalid_options', message)
}

/** Strict unsigned decimal: rejects '', '1e3', '0x10', '-1', '8080abc', ' 80'. */
function parseDecimal(flag: string, raw: string, expected: string): number {
  if (!/^\d+$/.test(raw)) throw optionsError(`${flag} must be ${expected}, got '${raw}'`)
  return Number(raw)
}

/**
 * Parse CLI arguments (without the executable and script). `--help`/`-h` and
 * `--list-sources` return at once.
 *
 * @throws {VisualizerError} `invalid_options` for an unknown flag, a flag
 *   without a value (a following `--flag` does not count as a value), an empty
 *   value, `--port` outside $[0, 65535]$ or `--baud` that is not an integer ≥ 1
 *   (both strictly decimal), or `--replay` combined with `--record`,
 *   `--source` or a source flag.
 */
export function parseArgs(argv: readonly string[]): DemoCommand {
  let port = 0
  let host = 'localhost'
  let source = 'crypto'
  let record: string | undefined
  let replay: string | undefined
  const liveFlags: string[] = []
  const sourceOpts: SourceOptions = {}
  let i = 0
  const value = (flag: string): string => {
    const v = argv[++i]
    if (v === undefined || v.startsWith('--')) throw optionsError(`missing value for ${flag}`)
    if (v.length === 0) throw optionsError(`empty value for ${flag}`)
    return v
  }
  for (; i < argv.length; i++) {
    const arg = argv[i] as string
    switch (arg) {
      case '--help':
      case '-h':
        return { command: 'help' }
      case '--list-sources':
        return { command: 'list-sources' }
      case '--port':
        port = parseDecimal('--port', value(arg), 'an integer in [0, 65535]')
        if (port > 65_535) throw optionsError(`--port must be in [0, 65535], got ${port}`)
        break
      case '--host':
        host = value(arg)
        break
      case '--replay':
        replay = value(arg)
        break
      case '--baud': {
        liveFlags.push(arg)
        const baud = parseDecimal('--baud', value(arg), 'a positive integer')
        if (!(Number.isSafeInteger(baud) && baud >= 1)) {
          throw optionsError(`--baud must be a positive integer, got ${baud}`)
        }
        sourceOpts.baudRate = baud
        break
      }
      case '--record':
        liveFlags.push(arg)
        record = value(arg)
        break
      case '--source':
        liveFlags.push(arg)
        source = value(arg)
        break
      case '--raw':
        liveFlags.push(arg)
        sourceOpts.raw = true
        break
      case '--serial-path':
        liveFlags.push(arg)
        sourceOpts.serialPath = value(arg)
        break
      case '--camera-device':
        liveFlags.push(arg)
        sourceOpts.cameraDevice = value(arg)
        break
      case '--mic-device':
        liveFlags.push(arg)
        sourceOpts.micDevice = value(arg)
        break
      case '--hwrng-path':
        liveFlags.push(arg)
        sourceOpts.hwrngPath = value(arg)
        break
      default:
        throw optionsError(`unknown argument: ${arg}`)
    }
  }
  if (replay !== undefined) {
    if (liveFlags.length > 0) {
      throw optionsError(
        `--replay plays a recording and cannot be combined with ${[...new Set(liveFlags)].join(', ')}`,
      )
    }
    return { command: 'replay', options: { port, host, replay } }
  }
  return {
    command: 'run',
    options: { port, host, source, sourceOpts, ...(record !== undefined && { record }) },
  }
}
