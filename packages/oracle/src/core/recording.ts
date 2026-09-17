import type { OracleInput } from '../types.js'
import { DelegatingReader } from './delegating-reader.js'
import { type ByteReader, type ByteReaderOptions, byteReader } from './reader.js'

/** A reader that remembers every byte it hands out. */
export interface RecordingReader {
  /** Pass this to casts / draws. Accounting delegates to the wrapped reader. */
  readonly reader: ByteReader
  /**
   * A copy of every byte consumed through {@link RecordingReader.reader} so
   * far, in order — including bytes discarded by rejection sampling.
   */
  bytes(): Uint8Array
}

class Recorder extends DelegatingReader {
  readonly #owns: boolean
  #buffer = new Uint8Array(64)
  #length = 0

  constructor(inner: ByteReader, owns: boolean) {
    super(inner)
    this.#owns = owns
  }

  protected override onByte(value: number): number {
    if (this.#length === this.#buffer.length) {
      const grown = new Uint8Array(this.#buffer.length * 2)
      grown.set(this.#buffer)
      this.#buffer = grown
    }
    this.#buffer[this.#length++] = value
    return value
  }

  recorded(): Uint8Array {
    return this.#buffer.slice(0, this.#length)
  }

  override async close(): Promise<void> {
    await super.close()
    if (this.#owns) await this.inner.close()
  }
}

/**
 * Wrap `input` so every consumed byte is captured — the replay record for a
 * reading from a live source. Casting on `bytes()` later reproduces the exact
 * same reading (casts are pure functions of their input bytes), provided
 * every read of the cast went through `reader`:
 *
 * ```ts
 * const rec = recordingReader(qrngProvider)
 * const live = await castSpread(rec.reader, 'celticCross')
 * await rec.reader.close()
 * const replay = await castSpread(rec.bytes(), 'celticCross') // same cards
 * ```
 *
 * `reader` is a reader you own: casts do not close it. Closing it releases
 * the stream it opened; when `input` was already a `ByteReader`, only the
 * recording view closes and the shared reader stays open. `opts` are the
 * {@link byteReader} options (`signal`, `chunkBytes`).
 *
 * @throws OracleError `'invalid_input'` exactly as {@link byteReader}
 */
export function recordingReader(
  input: OracleInput | ByteReader,
  opts: ByteReaderOptions = {},
): RecordingReader {
  const inner = byteReader(input, opts)
  const recorder = new Recorder(inner, inner !== input)
  return Object.freeze({
    reader: recorder,
    bytes: () => recorder.recorded(),
  })
}
