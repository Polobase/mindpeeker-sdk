import { EntropyError } from '../errors.js'
import type { EntropyProvider } from '../types.js'
import { type SerialOptions, type SerialPortLike, serialEntropy } from './serial.js'

/**
 * Presets for USB hardware RNGs whose documented modes are selected over the
 * serial port. Built from the vendors' documentation; not exercised on the
 * hardware by the library authors.
 */

type PresetBase = Omit<SerialOptions, 'port' | 'source' | 'baudRate' | 'init'>

/** A Web Serial port that may also expose `setSignals` (DTR control). */
interface SignalPort extends SerialPortLike {
  setSignals?(signals: { dataTerminalReady?: boolean }): Promise<void>
}

export interface TrueRngModeInfo {
  /** Baud rate that selects the mode after the knock sequence. */
  readonly baudRate: number
  /** `binary` byte stream, `ascii` text, or `packets` (framed ADC samples). */
  readonly output: 'binary' | 'ascii' | 'packets'
  /** Whether the device whitens the output. */
  readonly whitened: boolean
  readonly description: string
}

/**
 * TrueRNGpro (and TrueRNGpro V2) modes, per ubld.it "How-To Change
 * TrueRNGpro's Mode" (https://ubld.it/products/about/how-to-change-truerngpros-mode/):
 * the mode is selected by a knock of three baud-rate changes (110 → 300 → 110)
 * followed by the mode's baud rate; the device streams while DTR is set.
 */
export const TRUERNG_MODES = Object.freeze({
  normal: Object.freeze({
    baudRate: 300,
    output: 'binary',
    whitened: true,
    description: 'both generators combined and whitened (power-up default)',
  }),
  psuDebug: Object.freeze({
    baudRate: 1200,
    output: 'ascii',
    whitened: false,
    description: 'diagnostic: generator supply voltage in mV, ASCII lines',
  }),
  rngDebug: Object.freeze({
    baudRate: 2400,
    output: 'ascii',
    whitened: false,
    description: "diagnostic: both generators' raw values as '0xRRR 0xRRR' lines",
  }),
  rng1: Object.freeze({
    baudRate: 4800,
    output: 'binary',
    whitened: true,
    description: 'generator 1 only, whitened',
  }),
  rng2: Object.freeze({
    baudRate: 9600,
    output: 'binary',
    whitened: true,
    description: 'generator 2 only, whitened',
  }),
  rawBinary: Object.freeze({
    baudRate: 19200,
    output: 'packets',
    whitened: false,
    description: '4-byte packets of 10-bit ADC values of both generators with sequence codes',
  }),
  rawAscii: Object.freeze({
    baudRate: 38400,
    output: 'ascii',
    whitened: false,
    description: "10-bit ADC values of both generators as 'AAAA, BBBB' decimal lines",
  }),
} satisfies Record<string, TrueRngModeInfo>)

/** A TrueRNGpro mode name (a key of `TRUERNG_MODES`). */
export type TrueRngMode = keyof typeof TRUERNG_MODES

/** The baud rates of the TrueRNGpro mode-change knock, in order. */
export const TRUERNG_KNOCK_BAUD_RATES: readonly number[] = Object.freeze([110, 300, 110])

export interface TrueRngOptions extends PresetBase {
  /** Web Serial port of the TrueRNGpro. */
  port: SerialPortLike
  /**
   * A byte-stream mode: 'normal' (default), 'rng1' or 'rng2'. The ASCII and
   * packet modes of `TRUERNG_MODES` need their own parser and are rejected
   * with `invalid_request`.
   */
  mode?: TrueRngMode
}

function requirePort(port: unknown, preset: string): SerialPortLike {
  const candidate = port as SerialPortLike | undefined
  if (typeof candidate?.open !== 'function' || typeof candidate.close !== 'function') {
    throw new EntropyError('invalid_request', `${preset} requires a Web Serial { port }`, {
      provider: preset,
    })
  }
  return candidate
}

function modeError(preset: string, mode: unknown, allowed: readonly string[]): EntropyError {
  return new EntropyError(
    'invalid_request',
    `${preset}: mode must be one of ${allowed.map((m) => `'${m}'`).join(' | ')}, got ${String(mode)}`,
    { provider: preset },
  )
}

/**
 * `serialEntropy` preset for a TrueRNGpro: every session performs the
 * vendor's mode knock (reopening the port at 110, 300 and 110 baud), opens at
 * the mode's baud rate and asserts DTR when the port supports `setSignals`.
 * Named `truerng` (normal mode) or `truerng(<mode>)`. Credits and conditioning
 * follow `serialEntropy`'s defaults unless overridden.
 */
export function truerng(opts: TrueRngOptions): EntropyProvider {
  const { port: rawPort, mode = 'normal', ...rest } = opts ?? ({} as TrueRngOptions)
  const port = requirePort(rawPort, 'truerng') as SignalPort
  const binaryModes = Object.entries(TRUERNG_MODES)
    .filter(([, info]) => info.output === 'binary')
    .map(([name]) => name)
  if (!binaryModes.includes(mode)) throw modeError('truerng', mode, binaryModes)
  const { baudRate } = TRUERNG_MODES[mode]

  const knocking: SerialPortLike = {
    async open(options) {
      for (const knock of TRUERNG_KNOCK_BAUD_RATES) {
        await port.open({ baudRate: knock })
        await port.close()
      }
      await port.open(options)
      await port.setSignals?.({ dataTerminalReady: true })
    },
    close: () => port.close(),
    get readable() {
      return port.readable
    },
    get writable() {
      return port.writable
    },
  }

  return serialEntropy({
    name: mode === 'normal' ? 'truerng' : `truerng(${mode})`,
    ...rest,
    port: knocking,
    baudRate,
  })
}

/**
 * OneRNG command strings, per Moonbase Otago "OneRNG — Theory of operation"
 * (http://moonbaseotago.com/onerng/theory.html): 4 ASCII bytes each. The
 * entropy feed is off at power-up until `feedOn`; `cmd0`…`cmd7` select the
 * noise sources and whitening (`cmd4`/`cmd5` enable no noise at all).
 */
export const ONERNG_COMMANDS = Object.freeze({
  avalanche: 'cmd0',
  avalancheRaw: 'cmd1',
  avalancheRf: 'cmd2',
  avalancheRfRaw: 'cmd3',
  noNoise: 'cmd4',
  rf: 'cmd6',
  rfRaw: 'cmd7',
  feedOn: 'cmdO',
  feedOff: 'cmdo',
  flush: 'cmdw',
})

/** OneRNG noise modes (the command table minus the no-noise and control commands). */
export type OneRngMode =
  | 'avalanche'
  | 'avalancheRaw'
  | 'avalancheRf'
  | 'avalancheRfRaw'
  | 'rf'
  | 'rfRaw'

const ONERNG_MODES: readonly OneRngMode[] = Object.freeze([
  'avalanche',
  'avalancheRaw',
  'avalancheRf',
  'avalancheRfRaw',
  'rf',
  'rfRaw',
])

/**
 * Default credit for OneRNG's unwhitened modes, in bits per byte: below the
 * vendor's own estimate for raw avalanche noise (~7 b/B from a ~5 % excess of
 * ones) to leave a margin; whitened modes keep `serialEntropy`'s default.
 */
export const ONERNG_RAW_MIN_ENTROPY_PER_SAMPLE = 4

export interface OneRngOptions extends PresetBase {
  /** Web Serial port of the OneRNG. */
  port: SerialPortLike
  /** Noise mode. Default 'avalanche' (the device default: avalanche noise, whitened). */
  mode?: OneRngMode
}

const encoder = new TextEncoder()

/**
 * `serialEntropy` preset for a OneRNG: after opening, each session writes the
 * mode command, `cmdw` (flush the pool of the previous mode) and `cmdO` (feed
 * on); closing writes `cmdo` (feed off) before the port closes. Raw modes are
 * credited `ONERNG_RAW_MIN_ENTROPY_PER_SAMPLE` bits per byte unless
 * `minEntropyPerSample` is given. Named `onerng` or `onerng(<mode>)`. On a
 * host tty (not Web Serial) local echo must be off, or the device can read its
 * own output back as commands.
 */
export function onerng(opts: OneRngOptions): EntropyProvider {
  const { port: rawPort, mode = 'avalanche', ...rest } = opts ?? ({} as OneRngOptions)
  const port = requirePort(rawPort, 'onerng')
  if (!ONERNG_MODES.includes(mode)) throw modeError('onerng', mode, ONERNG_MODES)
  const raw = mode.endsWith('Raw')

  const polite: SerialPortLike = {
    open: (options) => port.open(options),
    async close() {
      try {
        const writer = port.writable?.getWriter()
        if (writer) {
          try {
            await writer.write(encoder.encode(ONERNG_COMMANDS.feedOff))
          } finally {
            writer.releaseLock()
          }
        }
      } catch {
        // best effort: the port may already be gone
      }
      await port.close()
    },
    get readable() {
      return port.readable
    },
    get writable() {
      return port.writable
    },
  }

  return serialEntropy({
    name: mode === 'avalanche' ? 'onerng' : `onerng(${mode})`,
    ...(raw ? { minEntropyPerSample: ONERNG_RAW_MIN_ENTROPY_PER_SAMPLE } : {}),
    ...rest,
    port: polite,
    init: encoder.encode(
      `${ONERNG_COMMANDS[mode]}${ONERNG_COMMANDS.flush}${ONERNG_COMMANDS.feedOn}`,
    ),
  })
}
