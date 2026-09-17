/**
 * Stream plumbing for the demo: pull pacing and a drop-oldest fan-out that lets
 * one device session feed several consumers. Runtime-agnostic (no Bun APIs).
 */
import { VisualizerError } from '../errors.js'
import {
  abortableSleep,
  CANCELLED,
  cancellableNext,
  closeIterator,
  toAsyncIterator,
} from './iterate.js'

/** Grace for an upstream `return()` after the fan-out stops pulling. */
const FAN_OUT_CLOSE_GRACE_MS = 100

/**
 * Pace a stream: after each item wait `intervalMs` before pulling the next.
 * Pull-based, so the source slows too; `signal` cuts a pending wait short and
 * ends the stream.
 *
 * @throws {VisualizerError} `invalid_options` unless `intervalMs` is finite and ≥ 0.
 */
export async function* paced<T>(
  src: AsyncIterable<T>,
  intervalMs: number,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  if (!(Number.isFinite(intervalMs) && intervalMs >= 0)) {
    throw new VisualizerError(
      'invalid_options',
      `pacing interval must be ≥ 0 ms, got ${intervalMs}`,
    )
  }
  for await (const item of src) {
    if (signal?.aborted) return
    yield item
    await abortableSleep(intervalMs, signal)
    if (signal?.aborted) return
  }
}

/** Options for {@link fanOut}. */
export interface FanOutOptions {
  /** Items queued per consumer before the oldest is dropped. Default 64. */
  readonly capacity?: number
  /** Aborting stops the shared pull (even a blocked one) and ends every consumer. */
  readonly signal?: AbortSignal
}

/**
 * Broadcast one stream to `n` independent consumers so a single physical
 * device (camera, serial port) is opened exactly once. Items are shared by
 * reference (treat them as read-only).
 *
 * - Lazy: nothing is pulled before the first consumer's `next()`.
 * - Each consumer has a bounded queue; a slow consumer loses its **oldest**
 *   queued items rather than blocking the source or the other consumers.
 * - The source ending ends every consumer after its queue drains; a source
 *   error is rethrown by every attached consumer after its queue drains.
 * - Aborting `signal` pre-empts a pending pull, ends every consumer at once and
 *   closes the source (`return()`, bounded wait).
 * - A consumer's `return()` detaches it immediately (even while its `next()` is
 *   pending); once every consumer has detached, the pull stops and the source is
 *   closed.
 *
 * @throws {VisualizerError} `invalid_options` unless `n` and `capacity` are integers ≥ 1.
 */
export function fanOut<T>(
  src: AsyncIterable<T>,
  n: number,
  opts: FanOutOptions = {},
): AsyncIterableIterator<T>[] {
  const capacity = opts.capacity ?? 64
  if (!Number.isInteger(n) || n < 1) {
    throw new VisualizerError('invalid_options', `fan-out needs an integer n ≥ 1, got ${n}`)
  }
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new VisualizerError(
      'invalid_options',
      `fan-out capacity must be an integer ≥ 1, got ${capacity}`,
    )
  }
  const { signal } = opts
  const queues: T[][] = Array.from({ length: n }, () => [])
  const waiters: (() => void)[][] = Array.from({ length: n }, () => [])
  const detached: boolean[] = new Array(n).fill(false)
  let active = n
  let started = false
  let finished = false
  let failure: { readonly error: unknown } | undefined
  let cancelPull: (() => void) | undefined

  const wake = (i: number): void => {
    for (const resolve of (waiters[i] as (() => void)[]).splice(0)) resolve()
  }
  const wakeAll = (): void => {
    for (let i = 0; i < n; i++) wake(i)
  }
  const detach = (i: number): void => {
    if (detached[i]) return
    detached[i] = true
    ;(queues[i] as T[]).length = 0
    active--
    if (active === 0) cancelPull?.()
    wake(i)
  }
  const onAbort = (): void => {
    cancelPull?.()
    wakeAll()
  }

  const pump = async (): Promise<void> => {
    signal?.addEventListener('abort', onAbort, { once: true })
    let upstream: AsyncIterator<T> | undefined
    let owesReturn = false
    try {
      if (signal?.aborted) return
      upstream = toAsyncIterator<T>(src)
      if (!upstream)
        throw new VisualizerError('invalid_options', 'fan-out source is not an AsyncIterable')
      owesReturn = true
      while (active > 0 && !signal?.aborted) {
        const pull = cancellableNext(upstream)
        cancelPull = pull.cancel
        let step: Awaited<typeof pull.result>
        try {
          step = await pull.result
        } catch (error) {
          owesReturn = false
          throw error
        } finally {
          cancelPull = undefined
        }
        if (step === CANCELLED) break
        if (step.done) {
          owesReturn = false
          break
        }
        for (let i = 0; i < n; i++) {
          if (detached[i]) continue
          const queue = queues[i] as T[]
          queue.push(step.value)
          if (queue.length > capacity) queue.shift()
          wake(i)
        }
      }
    } catch (error) {
      failure = { error }
    } finally {
      finished = true
      signal?.removeEventListener('abort', onAbort)
      wakeAll()
      if (owesReturn && upstream) await closeIterator(upstream, FAN_OUT_CLOSE_GRACE_MS)
    }
  }

  const done = (): IteratorReturnResult<undefined> => ({ done: true, value: undefined })

  return queues.map((queue, i) => {
    const consumer: AsyncIterableIterator<T> = {
      async next() {
        if (!started) {
          started = true
          void pump()
        }
        while (true) {
          if (detached[i]) return done()
          if (signal?.aborted) {
            detach(i)
            return done()
          }
          if (queue.length > 0) return { done: false, value: queue.shift() as T }
          if (finished) {
            detach(i)
            if (failure) throw failure.error
            return done()
          }
          await new Promise<void>((resolve) => (waiters[i] as (() => void)[]).push(resolve))
        }
      },
      async return() {
        detach(i)
        return done()
      },
      [Symbol.asyncIterator]() {
        return consumer
      },
    }
    return consumer
  })
}
