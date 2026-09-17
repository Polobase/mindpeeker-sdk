import { OracleError } from '../errors.js'
import {
  ASYNC_DISPOSE,
  abortedError,
  anyAborted,
  boundedWait,
  busyError,
  CLOSE_TIMEOUT_MS,
  closedError,
  type InternalReader,
  isUint8View,
  NO_SIGNALS,
  READ,
  ROOT,
  raceSignals,
  sourceError,
} from './internal.js'
import type { ByteReader } from './reader.js'

type Settled =
  | { readonly ok: true; readonly step: IteratorResult<Uint8Array> }
  | { readonly ok: false; readonly error: unknown }

/** One `iterator.next()` call; never rejects, so it can outlive an aborted read. */
interface Pull {
  readonly result: Promise<Settled>
  settled: boolean
}

const EMPTY = new Uint8Array(0)

/**
 * Reader over an async chunk iterator. Owns the iterator: `close()` calls its
 * `return()` exactly once, so a generator's `finally` (socket, device handle)
 * runs. A pull that an abort or `close()` cut short is kept and handed to the
 * next read — no chunk is lost and `iterator.next()` never runs concurrently.
 */
export class StreamReader implements InternalReader {
  readonly #iterator: AsyncIterator<Uint8Array>
  readonly #signal: readonly AbortSignal[]
  readonly #source?: string
  #chunk: Uint8Array = EMPTY
  #offset = 0
  #consumed = 0
  #fetched = 0
  #busy = false
  #closed = false
  /** The iterator reported `done` or threw: never call `return()` on it. */
  #finished = false
  #pull: Pull | undefined
  #cancel: ((err: OracleError) => void) | undefined
  #closing: Promise<void> | undefined

  constructor(iterator: AsyncIterator<Uint8Array>, signal?: AbortSignal, source?: string) {
    this.#iterator = iterator
    this.#signal = signal ? [signal] : NO_SIGNALS
    this.#source = source
  }

  get bytesConsumed(): number {
    return this.#consumed
  }

  /** Bytes delivered by the iterator so far, including bytes still buffered. */
  get bytesFetched(): number {
    return this.#fetched
  }

  get [ROOT](): ByteReader {
    return this
  }

  next(): Promise<number> {
    return this[READ](NO_SIGNALS)
  }

  async [READ](signals: readonly AbortSignal[]): Promise<number> {
    const source = this.#source
    if (this.#closed) throw closedError(source)
    const all = signals.length === 0 ? this.#signal : [...this.#signal, ...signals]
    if (anyAborted(all)) throw abortedError(source)
    if (this.#busy) throw busyError(source)
    if (this.#offset >= this.#chunk.length) {
      this.#busy = true
      try {
        while (this.#offset >= this.#chunk.length) {
          const step = await this.#nextStep(all)
          if (step.done === true) {
            this.#finished = true
            // A source may *return* instead of throwing on abort: still an abort.
            if (anyAborted(all)) throw abortedError(source)
            throw new OracleError(
              'insufficient_entropy',
              `stream ended after ${this.#consumed} bytes`,
              { source },
            )
          }
          if (!isUint8View(step.value)) {
            throw new OracleError('invalid_input', 'stream yielded a non-Uint8Array chunk', {
              source,
            })
          }
          this.#chunk = step.value
          this.#offset = 0
          this.#fetched += step.value.length
        }
      } finally {
        this.#busy = false
      }
    }
    this.#consumed++
    return this.#chunk[this.#offset++] as number
  }

  async #nextStep(signals: readonly AbortSignal[]): Promise<IteratorResult<Uint8Array>> {
    const source = this.#source
    const pull = this.#pull ?? this.#startPull()
    let settled: Settled
    try {
      settled = await raceSignals(pull.result, signals, source, (cancel) => {
        this.#cancel = cancel
      })
    } finally {
      this.#cancel = undefined
    }
    this.#pull = undefined
    if (!settled.ok) {
      this.#finished = true
      if (anyAborted(signals)) throw abortedError(source)
      throw sourceError(settled.error, source)
    }
    const step = settled.step
    if (typeof step !== 'object' || step === null) {
      this.#finished = true
      throw new OracleError('source_error', 'stream iterator returned a non-object result', {
        source,
      })
    }
    return step
  }

  #startPull(): Pull {
    let result: Promise<Settled>
    try {
      result = Promise.resolve(this.#iterator.next()).then(
        (step): Settled => ({ ok: true, step }),
        (error: unknown): Settled => ({ ok: false, error }),
      )
    } catch (error) {
      result = Promise.resolve({ ok: false, error })
    }
    const pull: Pull = { result, settled: false }
    void result.then(() => {
      pull.settled = true
    })
    this.#pull = pull
    return pull
  }

  /**
   * Release the stream: calls the iterator's `return()` exactly once (unless
   * it already ended), waits at most {@link CLOSE_TIMEOUT_MS} for it, and
   * swallows its errors. A pending read rejects with `'closed'`. When a pull
   * is still in flight, `return()` is requested but not awaited — an async
   * generator queues it behind the pending `next()`. Idempotent.
   */
  close(): Promise<void> {
    if (this.#closing !== undefined) return this.#closing
    this.#closed = true
    this.#chunk = EMPTY
    this.#offset = 0
    this.#cancel?.(closedError(this.#source))
    this.#closing = this.#finished ? Promise.resolve() : this.#release()
    return this.#closing
  }

  async #release(): Promise<void> {
    const iterator = this.#iterator
    if (typeof iterator.return !== 'function') return
    let done: Promise<unknown>
    try {
      done = Promise.resolve(iterator.return())
    } catch {
      return
    }
    const quiet = done.catch(() => undefined)
    const inFlight = this.#pull !== undefined && !this.#pull.settled
    if (inFlight) return
    await boundedWait(quiet, CLOSE_TIMEOUT_MS)
  }

  [ASYNC_DISPOSE](): Promise<void> {
    return this.close()
  }
}
