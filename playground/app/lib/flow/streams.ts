// Live inputs for the streaming section. CLIENT-ONLY.
//
// `pairStreams` accepts any async iterable of symbols, so both sides here are
// bit generators: a byte stream expanded MSB-first through the SDK's own
// `symbolsFromBytes`. Feeding the providers in as `ByteSource`s directly would
// give 0–255 symbols, and a 256×256×256 table needs far more than a demo's
// samples.

import { symbolsFromBytes, xoshiro128ss } from '@mindpeeker/flow'

export interface BitCounter {
  /** Bits pulled so far — for the accounting line. */
  bits: number
}

/**
 * MSB-first bits of a byte stream, stopping after `limit` bits. Closing the
 * generator (which `pairStreams` does) closes the byte stream underneath.
 */
export async function* bitStream(
  bytes: AsyncIterable<Uint8Array>,
  limit: number,
  counter?: BitCounter,
): AsyncGenerator<number> {
  let sent = 0
  for await (const chunk of bytes) {
    const bits = symbolsFromBytes(chunk, { alphabet: 2 })
    for (let i = 0; i < bits.length; i++) {
      if (sent >= limit) return
      sent++
      if (counter) counter.bits = sent
      yield bits[i] as number
    }
  }
}

export interface CoupledStreamOptions {
  /** Pairs to produce before both sides end. */
  pairs: number
  /** Y copies X from this many steps back. */
  lag: number
  /** Probability of copying, once coupling is on (0…1). */
  coupling: number
  /** Pair index at which the coupling switches on. */
  switchAt: number
  /** Seed for the coupling coin (xoshiro128**). */
  seed: number
}

export interface CoupledStreams {
  /** The live source, bit by bit. */
  a: AsyncGenerator<number>
  /** The follower: independent bits until `switchAt`, then a lagged copy. */
  b: AsyncGenerator<number>
  /** Pairs produced so far. */
  produced: () => number
}

/**
 * One live bit source, split into the two sides of a pair stream: A is the
 * source itself, B copies A's bit from `lag` steps back with probability
 * `coupling` — but only from pair `switchAt` on. Both sides are pulled in
 * lock-step by `pairStreams`; whichever asks first drives the producer and the
 * other side's symbol waits in a one-item queue, so neither side runs ahead.
 */
export function coupledBitStreams(
  source: AsyncIterable<number>,
  options: CoupledStreamOptions,
): CoupledStreams {
  const iterator = source[Symbol.asyncIterator]()
  const rng = xoshiro128ss(options.seed)
  const queueA: number[] = []
  const queueB: number[] = []
  const history: number[] = []
  let produced = 0
  let ended = false

  async function step(): Promise<readonly [number, number] | null> {
    if (ended || produced >= options.pairs) return null
    const next = await iterator.next()
    if (next.done === true) {
      ended = true
      return null
    }
    const x = (next.value as number) & 1
    const armed = produced >= options.switchAt && history.length >= options.lag
    const y = armed && rng() < options.coupling ? (history[0] as number) : rng() < 0.5 ? 1 : 0
    history.push(x)
    if (history.length > options.lag) history.shift()
    produced++
    return [x, y] as const
  }

  async function* sideA(): AsyncGenerator<number> {
    try {
      for (;;) {
        const queued = queueA.shift()
        if (queued !== undefined) {
          yield queued
          continue
        }
        const pair = await step()
        if (!pair) return
        queueB.push(pair[1])
        yield pair[0]
      }
    } finally {
      ended = true
      await iterator.return?.().catch(() => undefined)
    }
  }

  async function* sideB(): AsyncGenerator<number> {
    for (;;) {
      const queued = queueB.shift()
      if (queued !== undefined) {
        yield queued
        continue
      }
      const pair = await step()
      if (!pair) return
      queueA.push(pair[0])
      yield pair[1]
    }
  }

  return { a: sideA(), b: sideB(), produced: () => produced }
}
