import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { collectBytes, condition } from '../../src/internal/condition.js'

async function* chunksOf(...parts: Uint8Array[]) {
  for (const part of parts) yield part
}

/** PRNG byte chunks (xorshift32) — healthy raw material. */
function prngBytes(n: number, seed = 0x1234abcd): Uint8Array<ArrayBuffer> {
  let state = seed
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    out[i] = state & 0xff
  }
  return out
}

const BASE = {
  provider: 'test-src',
  minEntropyPerSample: 8,
  safetyFactor: 2,
  mode: 'conditioned',
} as const

describe('condition (conditioned mode)', () => {
  test('needs safetyFactor×256 credited bits per 32-byte block', async () => {
    // H=8, factor 2 → 512 bits credit → 64 raw bytes per block
    const raw = prngBytes(64)
    const out: Uint8Array[] = []
    for await (const block of condition(chunksOf(raw), { ...BASE })) out.push(block)
    expect(out).toHaveLength(1)
    expect(out[0]).toHaveLength(32)
  })

  test('does not emit before enough credit accumulates', async () => {
    const out: Uint8Array[] = []
    for await (const block of condition(chunksOf(prngBytes(63)), { ...BASE })) out.push(block)
    expect(out).toHaveLength(0)
  })

  test('output equals SHA-256 of the exact pooled bytes', async () => {
    const raw = prngBytes(64)
    const expected = new Uint8Array(await crypto.subtle.digest('SHA-256', raw))
    const out: Uint8Array[] = []
    for await (const block of condition(chunksOf(raw), { ...BASE })) out.push(block)
    expect(out[0]).toEqual(expected)
  })

  test('emits multiple blocks from a long stream, pool reset between blocks', async () => {
    const raw = prngBytes(128)
    const expectedA = new Uint8Array(await crypto.subtle.digest('SHA-256', raw.slice(0, 64)))
    const expectedB = new Uint8Array(await crypto.subtle.digest('SHA-256', raw.slice(64)))
    const out: Uint8Array[] = []
    for await (const block of condition(chunksOf(raw.slice(0, 50), raw.slice(50)), { ...BASE })) {
      out.push(block)
    }
    expect(out).toEqual([expectedA, expectedB])
  })

  test('fractional min-entropy raises the raw requirement', async () => {
    // H=1, factor 2 → 512 raw bytes per block
    const out: Uint8Array[] = []
    for await (const block of condition(chunksOf(prngBytes(512)), {
      ...BASE,
      minEntropyPerSample: 1,
    })) {
      out.push(block)
    }
    expect(out).toHaveLength(1)
  })

  test('propagates health failures mid-stream', async () => {
    const bad = new Uint8Array(64).fill(42) // constant → RCT trips
    const iter = condition(chunksOf(prngBytes(10), bad), { ...BASE })
    const err = await (async () => {
      try {
        for await (const _block of iter) {
          /* drain */
        }
        return undefined
      } catch (e) {
        return e as EntropyError
      }
    })()
    expect(err).toBeInstanceOf(EntropyError)
    expect(err?.code).toBe('health_test')
  })
})

describe('condition (raw mode)', () => {
  test('passes health-tested samples through byte-identically', async () => {
    const raw = prngBytes(100)
    const out: Uint8Array[] = []
    for await (const chunk of condition(chunksOf(raw.slice(0, 30), raw.slice(30)), {
      ...BASE,
      mode: 'raw',
    })) {
      out.push(chunk)
    }
    expect(out).toEqual([raw.slice(0, 30), raw.slice(30)])
  })

  test('still runs health tests in raw mode', async () => {
    const bad = new Uint8Array(16).fill(7)
    const iter = condition(chunksOf(bad), { ...BASE, mode: 'raw' })
    const err = await iter.next().catch((e) => e)
    expect((err as EntropyError).code).toBe('health_test')
  })
})

describe('collectBytes', () => {
  test('returns exactly n bytes, buffering the remainder', async () => {
    const stream = chunksOf(new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6, 7]))
    const bytes = await collectBytes(stream, 5, 'test-src')
    expect(bytes).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
  })

  test('throws insufficient_entropy when the stream ends early', async () => {
    const err = (await collectBytes(chunksOf(new Uint8Array([1, 2])), 5, 'test-src').catch(
      (e) => e,
    )) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('insufficient_entropy')
  })
})
