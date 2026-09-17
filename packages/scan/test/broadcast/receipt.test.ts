import { describe, expect, test } from 'bun:test'
import type { Rate } from '@mindpeeker/rate'
import { broadcast } from '../../src/broadcast/broadcast.js'
import { parseReceipt, serializeReceipt, WITNESS_KINDS } from '../../src/broadcast/receipt.js'
import { ScanError } from '../../src/errors.js'
import type { BroadcastReceipt, BroadcastTick } from '../../src/types.js'
import { cyclingSource, prngBytes } from '../helpers/byte-sources.js'

const RATE: Rate = { digits: [12, 33, 7], base: 44 }
const HASH = 'a'.repeat(64)

async function receiptOf(gen: AsyncGenerator<BroadcastTick, BroadcastReceipt, void>) {
  let step = await gen.next()
  while (!step.done) step = await gen.next()
  return step.value
}

describe('receipt JSONL', () => {
  test('a v2 signature receipt round-trips byte-exact with a fixed key order', async () => {
    const receipt = await receiptOf(
      broadcast('Jane Roe', cyclingSource('u', prngBytes(4096, 2)), {
        rounds: 5,
        roundBytes: 8,
        now: () => 1751980800000,
      }),
    )
    const line = serializeReceipt(receipt)
    expect(Object.keys(JSON.parse(line))).toEqual([
      'v',
      't',
      'mode',
      'target',
      'witnessKind',
      'witnessHash',
      'bytesConsumed',
      'resonances',
      'rounds',
      'outputHash',
    ])
    expect(parseReceipt(line)).toEqual(receipt)
    expect(serializeReceipt(parseReceipt(line))).toBe(line)
  })

  test('a rate-target receipt (no witness) round-trips', async () => {
    const receipt = await receiptOf(
      broadcast(RATE, cyclingSource('u', prngBytes(2048, 4)), {
        rounds: 3,
        roundBytes: 8,
        now: () => 1,
      }),
    )
    const line = serializeReceipt(receipt)
    expect(serializeReceipt(parseReceipt(line))).toBe(line)
    expect(line).not.toContain('witness')
  })

  test('legacy v1 lines from 0.1 still parse and round-trip', () => {
    const v1 = `{"v":1,"t":1751980800000,"target":"12-33-7","witnessHash":"${HASH}","bytesConsumed":32,"resonances":0,"rounds":2}`
    const parsed = parseReceipt(v1)
    expect(parsed.v).toBe(1)
    expect(parsed.outputHash).toBeUndefined()
    expect(serializeReceipt(parsed)).toBe(v1)
  })

  test('malformed lines are rejected', () => {
    const v2 = (patch: Record<string, unknown>) =>
      JSON.stringify({
        v: 2,
        t: 1,
        mode: 'xor',
        target: '1-2',
        bytesConsumed: 16,
        resonances: 0,
        rounds: 1,
        outputHash: HASH,
        ...patch,
      })
    expect(() => parseReceipt(v2({}))).not.toThrow()
    for (const line of [
      'not json',
      '[]',
      '{"v":3}',
      '{"v":1,"t":1,"target":"","bytesConsumed":1,"resonances":0,"rounds":1}',
      v2({ outputHash: undefined }),
      v2({ outputHash: 'xyz' }),
      v2({ mode: 'loud' }),
      v2({ witnessKind: 'aura' }),
      v2({ witnessHash: 'ABC' }),
      v2({ bytesConsumed: -1 }),
      v2({ rounds: 1.5 }),
      v2({ resonances: 2 }),
      v2({ t: null }),
      v2({ extra: true }),
    ]) {
      expect(() => parseReceipt(line)).toThrow(ScanError)
    }
  })

  test('witness kinds are the documented set', () => {
    expect([...WITNESS_KINDS]).toEqual([
      'sample',
      'photograph',
      'signature',
      'name',
      'coordinates',
      'water',
      'symbol',
      'other',
    ])
    expect(Object.isFrozen(WITNESS_KINDS)).toBe(true)
  })
})
