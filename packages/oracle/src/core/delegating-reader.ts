import {
  ASYNC_DISPOSE,
  abortedError,
  anyAborted,
  busyError,
  checkByte,
  closedError,
  type InternalReader,
  isInternalReader,
  NO_SIGNALS,
  READ,
  ROOT,
  raceSignals,
  rootOf,
  sourceError,
} from './internal.js'
import type { ByteReader } from './reader.js'

/**
 * Base for readers that wrap another reader: accounting delegates to the
 * inner reader, reads go through the package-private protocol when the inner
 * reader speaks it (so an abort leaves it reusable), and fall back to
 * `inner.next()` raced against the signals — with byte validation, a busy
 * guard, and `'source_error'` wrapping — for foreign readers.
 *
 * `close()` rejects a read pending through this wrapper with `'closed'` (the
 * inner reader keeps an in-flight pull for its next read).
 */
export abstract class DelegatingReader implements InternalReader {
  protected readonly inner: ByteReader
  /** Aborted by `close()`: cancels reads pending through this wrapper. */
  readonly #closer = new AbortController()
  readonly #signals: readonly AbortSignal[]
  #busy = false
  #closed = false

  constructor(inner: ByteReader, signals: readonly AbortSignal[] = NO_SIGNALS) {
    this.inner = inner
    this.#signals = [this.#closer.signal, ...signals]
  }

  get bytesConsumed(): number {
    return this.inner.bytesConsumed
  }

  get bytesFetched(): number | undefined {
    return this.inner.bytesFetched
  }

  get [ROOT](): ByteReader {
    return rootOf(this.inner)
  }

  next(): Promise<number> {
    return this[READ](NO_SIGNALS)
  }

  async [READ](signals: readonly AbortSignal[]): Promise<number> {
    if (this.#closed) throw closedError()
    const all = signals.length === 0 ? this.#signals : [...this.#signals, ...signals]
    if (anyAborted(all)) throw abortedError()
    try {
      return this.onByte(await this.#read(all))
    } catch (err) {
      if (this.#closed) throw closedError()
      throw err
    }
  }

  async #read(all: readonly AbortSignal[]): Promise<number> {
    const inner = this.inner
    if (isInternalReader(inner)) return inner[READ](all)
    if (this.#busy) throw busyError()
    this.#busy = true
    try {
      let pending: Promise<number>
      try {
        pending = Promise.resolve(inner.next())
      } catch (err) {
        throw sourceError(err)
      }
      let value: unknown
      try {
        value = await raceSignals(pending, all)
      } catch (err) {
        if (anyAborted(all)) throw abortedError()
        throw sourceError(err)
      }
      return checkByte(value)
    } finally {
      this.#busy = false
    }
  }

  /** Hook for every byte handed out through this wrapper. */
  protected onByte(value: number): number {
    return value
  }

  /** Mark this wrapper closed; subclasses decide whether the inner reader closes too. */
  close(): Promise<void> {
    if (!this.#closed) {
      this.#closed = true
      this.#closer.abort()
    }
    return Promise.resolve()
  }

  [ASYNC_DISPOSE](): Promise<void> {
    return this.close()
  }
}

/**
 * A per-use AbortSignal layered over an existing reader. `close()` only
 * closes this view — the shared inner reader stays open for later casts.
 */
export class SignalReader extends DelegatingReader {
  constructor(inner: ByteReader, signal: AbortSignal) {
    super(inner, [signal])
  }
}
