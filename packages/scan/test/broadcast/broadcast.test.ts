import { describe, expect, test } from 'bun:test'
import { type Rate, xorImprint } from '@mindpeeker/rate'
import { broadcast, parseReceipt, serializeReceipt } from '../../src/broadcast/broadcast.js'
import { ScanError } from '../../src/errors.js'
import type { BroadcastReceipt, BroadcastTick } from '../../src/types.js'
import { batchSource, collect, cyclingSource, prngBytes } from '../helpers/byte-sources.js'

const RATE: Rate = { digits: [12, 33, 7], base: 44 }

async function drive(
  gen: AsyncGenerator<BroadcastTick, BroadcastReceipt, void>,
): Promise<{ ticks: BroadcastTick[]; receipt: BroadcastReceipt }> {
  const ticks: BroadcastTick[] = []
  let step = await gen.next()
  while (!step.done) {
    ticks.push(step.value)
    step = await gen.next()
  }
  return { ticks, receipt: step.value }
}

describe('broadcast — modulation is reversible (xor mode)', () => {
  test('xorImprint applied twice is the identity across chunk boundaries', async () => {
    const whole = prngBytes(90, 5)
    const once = await collect(xorImprint(batchSource('s', whole, 17), RATE))
    const twice = await collect(xorImprint(once, RATE))
    expect([...twice]).toEqual([...whole])
  })

  test("each round's modulated bytes reverse to the raw round", async () => {
    const roundBytes = 8
    const rounds = 4
    const raw = prngBytes(roundBytes * rounds, 9)
    const { ticks, receipt } = await drive(
      broadcast(RATE, batchSource('s', raw, 8), { mode: 'xor', rounds, roundBytes }),
    )
    expect(ticks.length).toBe(rounds)
    for (let r = 0; r < rounds; r++) {
      const expected = raw.subarray(r * roundBytes, (r + 1) * roundBytes)
      const recovered = await collect(xorImprint(ticks[r]?.modulated as Uint8Array, RATE))
      expect([...recovered]).toEqual([...expected])
    }
    expect(receipt.bytesConsumed).toBe(roundBytes * rounds)
    expect(receipt.rounds).toBe(rounds)
  })
})

describe('broadcast — resonance tally', () => {
  test('fires exactly on the configured value', async () => {
    // odds 2, value 1 → resonance iff the round's first byte is odd.
    const raw = Uint8Array.from([
      1, 0, 0, 0, /* round 0: odd → hit */ 2, 0, 0, 0 /* round 1: even */,
    ])
    const { ticks, receipt } = await drive(
      broadcast(RATE, batchSource('s', raw, 4), {
        rounds: 2,
        roundBytes: 4,
        resonanceOdds: 2,
        resonanceValue: 1,
      }),
    )
    expect(ticks.map((t) => t.resonance)).toEqual([true, false])
    expect(receipt.resonances).toBe(1)
  })
})

describe('broadcast — target resolution + receipt', () => {
  test('a Rate target has no witnessHash; a signature target does', async () => {
    const src = () => cyclingSource('u', prngBytes(4096, 1))
    const rated = await drive(broadcast(RATE, src(), { rounds: 3, roundBytes: 8 }))
    expect(rated.receipt.witnessHash).toBeUndefined()
    expect(rated.receipt.target).toBe('12-33-7')

    const signed = await drive(broadcast('Jane Roe', src(), { rounds: 3, roundBytes: 8 }))
    expect(typeof signed.receipt.witnessHash).toBe('string')
    expect(signed.receipt.witnessHash?.length).toBe(64)

    const witnessed = await drive(
      broadcast({ name: 'subject', signature: 'hair-sample' }, src(), { rounds: 2, roundBytes: 8 }),
    )
    expect(witnessed.receipt.witnessHash?.length).toBe(64)
  })

  test('an unresolvable target throws invalid_target', async () => {
    const gen = broadcast({} as never, cyclingSource('u', prngBytes(64, 1)), { rounds: 1 })
    expect(gen.next()).rejects.toMatchObject({ name: 'ScanError', code: 'invalid_target' })
  })

  test('receipt JSONL round-trips byte-exact', async () => {
    const { receipt } = await drive(
      broadcast('Jane Roe', cyclingSource('u', prngBytes(4096, 2)), {
        rounds: 5,
        roundBytes: 8,
        now: () => 1751980800000,
      }),
    )
    const line = serializeReceipt(receipt)
    expect(parseReceipt(line)).toEqual(receipt)
    expect(serializeReceipt(parseReceipt(line))).toBe(line)
    expect(JSON.parse(line).v).toBe(1)
  })

  test('a rate-target receipt (no witnessHash) round-trips', async () => {
    const { receipt } = await drive(
      broadcast(RATE, cyclingSource('u', prngBytes(2048, 4)), {
        rounds: 3,
        roundBytes: 8,
        now: () => 1751980800000,
      }),
    )
    expect(serializeReceipt(parseReceipt(serializeReceipt(receipt)))).toBe(
      serializeReceipt(receipt),
    )
  })

  test('malformed receipt lines are rejected', () => {
    expect(() => parseReceipt('not json')).toThrow(ScanError)
    expect(() => parseReceipt('{"v":2}')).toThrow(ScanError)
    expect(() =>
      parseReceipt('{"v":1,"t":1,"target":"","bytesConsumed":1,"resonances":0,"rounds":1}'),
    ).toThrow(ScanError)
  })
})

describe('broadcast — control flow', () => {
  test('durationMs bounds the run via the injected clock', async () => {
    let t = 0
    const { ticks } = await drive(
      broadcast(RATE, cyclingSource('u', prngBytes(8192, 1)), {
        durationMs: 3,
        roundBytes: 8,
        now: () => t++,
      }),
    )
    // clock advances one ms per `now()` call; the run stops once now() >= deadline
    expect(ticks.length).toBeGreaterThan(0)
    expect(ticks.length).toBeLessThan(10)
  })

  test('abort mid-stream rejects cleanly with aborted', async () => {
    const ac = new AbortController()
    const gen = broadcast(RATE, cyclingSource('u', prngBytes(8192, 1)), {
      rounds: 1000,
      roundBytes: 8,
      signal: ac.signal,
    })
    const first = await gen.next()
    expect(first.done).toBe(false)
    ac.abort()
    expect(gen.next()).rejects.toMatchObject({ name: 'ScanError', code: 'aborted' })
  })

  test('a source that ends stops the broadcast cleanly with a receipt', async () => {
    const raw = prngBytes(8 * 3, 1) // exactly 3 rounds of 8 bytes
    const { ticks, receipt } = await drive(
      broadcast(RATE, batchSource('s', raw, 8), { rounds: 1000, roundBytes: 8 }),
    )
    expect(ticks.length).toBe(3)
    expect(receipt.rounds).toBe(3)
    expect(receipt.bytesConsumed).toBe(24)
  })
})
