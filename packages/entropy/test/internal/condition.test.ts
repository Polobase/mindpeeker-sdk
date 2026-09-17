import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import {
  type ConditionerConfig,
  collectBytes,
  condition,
  STARTUP_SAMPLES,
} from '../../src/internal/condition.js'

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

async function drain(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
  const out: Uint8Array[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

async function failure(stream: AsyncIterable<Uint8Array>): Promise<EntropyError | undefined> {
  try {
    await drain(stream)
    return undefined
  } catch (e) {
    return e as EntropyError
  }
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')
const SHA256_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

/** Pooling-arithmetic tests run without the start-up hold. */
const BASE: ConditionerConfig = {
  provider: 'test-src',
  minEntropyPerSample: 8,
  safetyFactor: 2,
  mode: 'conditioned',
  startupSamples: 0,
}

describe('condition (conditioned mode)', () => {
  test('needs safetyFactor×256 credited bits per 32-byte block', async () => {
    // H=8, factor 2 → 512 bits credit → 64 raw bytes per block
    const out = await drain(condition(chunksOf(prngBytes(64)), { ...BASE }))
    expect(out).toHaveLength(1)
    expect(out[0]).toHaveLength(32)
  })

  test('does not emit before enough credit accumulates', async () => {
    expect(await drain(condition(chunksOf(prngBytes(63)), { ...BASE }))).toHaveLength(0)
  })

  test('output equals SHA-256 of the exact pooled bytes', async () => {
    const raw = prngBytes(64)
    const expected = new Uint8Array(await crypto.subtle.digest('SHA-256', raw))
    const out = await drain(condition(chunksOf(raw), { ...BASE }))
    expect(out[0]).toEqual(expected)
  })

  test('emits multiple blocks from a long stream, pool reset between blocks', async () => {
    const raw = prngBytes(128)
    const expectedA = new Uint8Array(await crypto.subtle.digest('SHA-256', raw.slice(0, 64)))
    const expectedB = new Uint8Array(await crypto.subtle.digest('SHA-256', raw.slice(64)))
    const out = await drain(condition(chunksOf(raw.slice(0, 50), raw.slice(50)), { ...BASE }))
    expect(out).toEqual([expectedA, expectedB])
  })

  test('one large chunk yields every whole block and carries the remainder', async () => {
    const raw = prngBytes(64 * 5 + 10)
    const expected = await Promise.all(
      [0, 1, 2, 3, 4, 5].map(async (b) =>
        hex(new Uint8Array(await crypto.subtle.digest('SHA-256', raw.slice(b * 64, b * 64 + 64)))),
      ),
    )
    const tail = prngBytes(54, 0x777)
    const whole = new Uint8Array(64 * 6)
    whole.set(raw)
    whole.set(tail, raw.length)
    expected[5] = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', whole.slice(320))))
    const out = await drain(condition(chunksOf(raw, tail), { ...BASE }))
    expect(out.map(hex)).toEqual(expected)
  })

  test('fractional min-entropy raises the raw requirement', async () => {
    // H=1, factor 2 → 512 raw bytes per block
    const out = await drain(
      condition(chunksOf(prngBytes(512)), { ...BASE, minEntropyPerSample: 1 }),
    )
    expect(out).toHaveLength(1)
  })

  test('propagates health failures under onHealthFailure: throw', async () => {
    const bad = new Uint8Array(64).fill(42) // constant → RCT trips
    const err = await failure(
      condition(chunksOf(prngBytes(10), bad), { ...BASE, onHealthFailure: 'throw' }),
    )
    expect(err).toBeInstanceOf(EntropyError)
    expect(err?.code).toBe('health_test')
    expect(err?.message).not.toContain('tolerated')
  })
})

describe('condition: conditioner validation (constant SHA-256("") regression)', () => {
  // Before the fix, bytesPerBlock <= 0 made the pool loop hash an EMPTY block
  // forever: every output block was SHA-256('') = e3b0c442…b855.
  test('the constant those configurations used to emit is SHA-256 of nothing', async () => {
    expect(hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(0))))).toBe(
      SHA256_EMPTY,
    )
  })

  for (const [label, patch] of [
    ['safetyFactor 0', { safetyFactor: 0 }],
    ['safetyFactor -1', { safetyFactor: -1 }],
    ['safetyFactor NaN', { safetyFactor: Number.NaN }],
    ['minEntropyPerSample Infinity', { minEntropyPerSample: Number.POSITIVE_INFINITY }],
    ['minEntropyPerSample 64 (< 32 bytes per block)', { minEntropyPerSample: 64 }],
  ] as const) {
    test(`${label} is rejected with invalid_request instead of emitting SHA-256('')`, async () => {
      const blocks: string[] = []
      let err: EntropyError | undefined
      try {
        for await (const block of condition(chunksOf(prngBytes(4096)), { ...BASE, ...patch })) {
          blocks.push(hex(block))
          if (blocks.length === 4) break
        }
      } catch (e) {
        err = e as EntropyError
      }
      expect(blocks).not.toContain(SHA256_EMPTY)
      expect(blocks).toHaveLength(0)
      expect(err).toBeInstanceOf(EntropyError)
      expect(err?.code).toBe('invalid_request')
    })
  }

  test('rejects invalid maxHealthFailures and startupSamples', async () => {
    expect((await failure(condition(chunksOf(), { ...BASE, maxHealthFailures: 0 })))?.code).toBe(
      'invalid_request',
    )
    expect((await failure(condition(chunksOf(), { ...BASE, startupSamples: -1 })))?.code).toBe(
      'invalid_request',
    )
  })
})

describe('condition: start-up test (SP 800-90B §4.3)', () => {
  const STARTUP: ConditionerConfig = { ...BASE, mode: 'raw', startupSamples: undefined }

  test('defaults to 1024 samples', () => {
    expect(STARTUP_SAMPLES).toBe(1024)
  })

  test('releases nothing until 1024 samples have passed, then releases them all', async () => {
    const raw = prngBytes(1024)
    const parts = [raw.slice(0, 1000), raw.slice(1000)]
    const iter = condition(chunksOf(prngBytes(1000)), STARTUP)
    expect((await iter.next()).done).toBe(true) // source ended inside the start-up test
    const out = await drain(condition(chunksOf(...parts), STARTUP))
    expect(out).toEqual(parts)
  })

  test('conditioned mode pools the released start-up samples', async () => {
    const raw = prngBytes(1024)
    const out = await drain(condition(chunksOf(raw), { ...STARTUP, mode: 'conditioned' }))
    expect(out).toHaveLength(16) // 1024 / 64
    expect(out[0]).toEqual(new Uint8Array(await crypto.subtle.digest('SHA-256', raw.slice(0, 64))))
  })

  test('an alarm during the start-up test withholds every held sample', async () => {
    const bad = new Uint8Array(8).fill(7) // RCT cutoff 4 at H = 8
    const err = await failure(
      condition(chunksOf(prngBytes(900), bad), { ...STARTUP, onHealthFailure: 'throw' }),
    )
    expect(err?.code).toBe('health_test')
  })
})

describe('condition: restart semantics (onHealthFailure retest)', () => {
  const RETEST: ConditionerConfig = { ...BASE, mode: 'raw', startupSamples: 64 }
  const stuck = () => new Uint8Array(16).fill(3)

  test('an alarm discards the chunk, re-runs the start-up test and resumes', async () => {
    const a = prngBytes(64, 1)
    const b = prngBytes(64, 2)
    const c = prngBytes(64, 3)
    const out = await drain(condition(chunksOf(a, stuck(), b, c), RETEST))
    // a completes the 64-sample start-up and is released; the stuck chunk
    // trips the RCT and is dropped; b alone completes the fresh start-up test
    // and is released; c flows normally
    expect(out).toEqual([a, b, c])
  })

  test('held start-up samples and the conditioning pool are discarded on an alarm', async () => {
    const config: ConditionerConfig = { ...BASE, startupSamples: 64 }
    const a = prngBytes(64, 11) // start-up
    const b = prngBytes(40, 12) // pooled, not yet a block
    const c = prngBytes(64, 13) // fresh start-up after the alarm
    const out = await drain(condition(chunksOf(a, b, stuck(), c), config))
    const blockA = new Uint8Array(await crypto.subtle.digest('SHA-256', a))
    const blockC = new Uint8Array(await crypto.subtle.digest('SHA-256', c))
    // without the discard, c would have been pooled after b (b ‖ c[0..24])
    expect(out).toEqual([blockA, blockC])
  })

  test('the maxHealthFailures-th alarm of a session throws health_test', async () => {
    const ok = () => prngBytes(64, 5)
    const err = await failure(
      condition(chunksOf(ok(), stuck(), ok(), stuck(), ok(), stuck(), ok()), RETEST),
    )
    expect(err?.code).toBe('health_test')
    expect(err?.message).toContain('alarm 3 of 3')
  })

  test('fewer alarms than maxHealthFailures never throw', async () => {
    const ok = (seed: number) => prngBytes(64, seed)
    const out = await drain(
      condition(chunksOf(ok(1), stuck(), ok(2), stuck(), ok(3)), {
        ...RETEST,
        maxHealthFailures: 3,
      }),
    )
    expect(out).toHaveLength(3)
  })

  test('maxHealthFailures: 1 behaves like onHealthFailure: throw', async () => {
    const err = await failure(
      condition(chunksOf(prngBytes(64), stuck()), { ...RETEST, maxHealthFailures: 1 }),
    )
    expect(err?.code).toBe('health_test')
  })

  test('a dead source still fails fast by default', async () => {
    async function* dead() {
      while (true) yield new Uint8Array(64).fill(9)
    }
    const err = await failure(condition(dead(), { ...BASE, startupSamples: undefined }))
    expect(err?.code).toBe('health_test')
  })
})

describe('condition (raw mode)', () => {
  test('passes health-tested samples through byte-identically', async () => {
    const raw = prngBytes(100)
    const out = await drain(
      condition(chunksOf(raw.slice(0, 30), raw.slice(30)), { ...BASE, mode: 'raw' }),
    )
    expect(out).toEqual([raw.slice(0, 30), raw.slice(30)])
  })

  test('still runs health tests in raw mode', async () => {
    const bad = new Uint8Array(16).fill(7)
    const iter = condition(chunksOf(bad), { ...BASE, mode: 'raw', onHealthFailure: 'throw' })
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
