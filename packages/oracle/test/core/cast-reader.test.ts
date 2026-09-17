import { describe, expect, test } from 'bun:test'
import { DEFAULT_CAST_CHUNK_BYTES } from '../../src/core/cast-reader.js'
import { type ByteReader, byteReader } from '../../src/core/reader.js'
import { OracleError } from '../../src/errors.js'
import { castShield } from '../../src/systems/geomancy/cast.js'
import { castHexagram } from '../../src/systems/iching/cast.js'
import { castRunes } from '../../src/systems/runes/cast.js'
import { castSpread } from '../../src/systems/tarot/cast.js'
import type { OracleInput } from '../../src/types.js'
import { liveSource, prngBytes, stalledIterable } from '../helpers/byte-sources.js'

type AnyCast = (
  input: OracleInput | ByteReader,
  opts?: { signal?: AbortSignal; chunkBytes?: number },
) => Promise<{ readonly bytesConsumed: number; readonly bytesFetched?: number }>

const casts: readonly (readonly [string, AnyCast])[] = [
  ['castHexagram', (input, opts) => castHexagram(input, opts)],
  ['castSpread', (input, opts) => castSpread(input, 'celticCross', { ...opts, reversals: true })],
  ['castRunes', (input, opts) => castRunes(input, 5, { ...opts, merkstave: true })],
  ['castShield', (input, opts) => castShield(input, opts)],
]

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
    return 'no-throw'
  } catch (err) {
    expect(err).toBeInstanceOf(OracleError)
    return (err as OracleError).code
  }
}

describe.each(casts)('%s reader lifecycle', (_name, cast) => {
  test('closes the stream it opened on a ByteSource (generator finally runs)', async () => {
    const source = liveSource('ws')
    await cast(source)
    expect(source.opened).toBe(1)
    expect(source.finalized).toBe(1)
  })

  test('closes the stream when the cast is aborted mid-read', async () => {
    const source = liveSource('ws')
    const controller = new AbortController()
    const pending = cast(source, { signal: controller.signal })
    controller.abort()
    expect(await codeOf(pending)).toBe('aborted')
    // return() was requested while the pull was in flight; the generator runs
    // its finally as soon as that pull settles.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(source.finalized).toBe(source.opened)
  })

  test('requests DEFAULT_CAST_CHUNK_BYTES (32) unless chunkBytes is given', async () => {
    const source = liveSource('metered', 1024)
    const result = await cast(source)
    expect(source.lastOpts?.chunkBytes).toBe(DEFAULT_CAST_CHUNK_BYTES)
    expect(result.bytesFetched).toBe(32)
    expect(result.bytesFetched).toBeGreaterThanOrEqual(result.bytesConsumed)
    const small = liveSource('metered', 1024)
    await cast(small, { chunkBytes: 4 })
    expect(small.lastOpts?.chunkBytes).toBe(4)
  })

  test('never closes a caller-supplied reader', async () => {
    const source = liveSource('shared')
    const reader = byteReader(source)
    await cast(reader)
    await cast(reader, { signal: new AbortController().signal })
    expect(source.opened).toBe(1)
    expect(source.finalized).toBe(0)
    expect(typeof (await reader.next())).toBe('number')
    await reader.close()
    expect(source.finalized).toBe(1)
  })

  test('a per-cast signal aborts a cast on a shared stalled reader', async () => {
    const reader = byteReader(stalledIterable())
    const controller = new AbortController()
    const pending = cast(reader, { signal: controller.signal })
    setTimeout(() => controller.abort(), 5)
    expect(await codeOf(pending)).toBe('aborted')
    const preAborted = cast(reader, { signal: AbortSignal.abort() })
    expect(await codeOf(preAborted)).toBe('aborted')
  })

  test('a second concurrent cast on the same reader throws invalid_input', async () => {
    const reader = byteReader(prngBytes(256, 0xc0c0))
    const results = await Promise.allSettled([cast(reader), cast(reader)])
    expect(results[0]?.status).toBe('fulfilled')
    expect(results[1]?.status).toBe('rejected')
    const reason = (results[1] as PromiseRejectedResult).reason as OracleError
    expect(reason.code).toBe('invalid_input')
    // The lease is released: sequential casts work again and accounting is contiguous.
    const before = reader.bytesConsumed
    const next = await cast(reader)
    expect(reader.bytesConsumed - before).toBe(next.bytesConsumed)
  })

  test('the lease also covers views of the same reader', async () => {
    const reader = byteReader(prngBytes(256, 0xd0d0))
    const view = byteReader(reader, { signal: new AbortController().signal })
    const results = await Promise.allSettled([cast(reader), cast(view)])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected'])
  })
})

describe('cast option bags', () => {
  test('null options are rejected with invalid_input by every cast', async () => {
    const bytes = new Uint8Array(64)
    expect(await codeOf(castHexagram(bytes, null as never))).toBe('invalid_input')
    expect(await codeOf(castSpread(bytes, 'single', null as never))).toBe('invalid_input')
    expect(await codeOf(castRunes(bytes, 1, null as never))).toBe('invalid_input')
    expect(await codeOf(castShield(bytes, null as never))).toBe('invalid_input')
  })
})

describe('a finite input consumed like for-await', () => {
  test('a cast closes an AsyncIterable input it adapted (its iterator is return()ed)', async () => {
    let finalized = 0
    async function* gen() {
      try {
        while (true) yield prngBytes(8, 3)
      } finally {
        finalized++
      }
    }
    const iterable = gen()
    await castShield(iterable)
    expect(finalized).toBe(1)
  })
})
