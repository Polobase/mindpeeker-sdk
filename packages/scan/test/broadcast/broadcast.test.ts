import { describe, expect, test } from 'bun:test'
import { type Rate, xorImprint } from '@mindpeeker/rate'
import { broadcast } from '../../src/broadcast/broadcast.js'
import { sha256Hex } from '../../src/broadcast/signature.js'
import { Sha256, toHex } from '../../src/internal/sha256.js'
import type { BroadcastReceipt, BroadcastTick } from '../../src/types.js'
import {
  batchSource,
  codedError,
  collect,
  cyclingSource,
  failingSource,
  prngBytes,
} from '../helpers/byte-sources.js'

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

function concat(ticks: readonly BroadcastTick[]): Uint8Array {
  const out = new Uint8Array(ticks.reduce((n, t) => n + t.modulated.length, 0))
  let offset = 0
  for (const t of ticks) {
    out.set(t.modulated, offset)
    offset += t.modulated.length
  }
  return out
}

describe('broadcast — one modulation stream', () => {
  test('xorImprint applied twice is the identity across chunk boundaries', async () => {
    const whole = prngBytes(90, 5)
    const once = await collect(xorImprint(batchSource('s', whole, 17), RATE))
    const twice = await collect(xorImprint(once, RATE))
    expect([...twice]).toEqual([...whole])
  })

  test('concatenated ticks equal xorImprint of the raw stream (8-byte rounds, 3 digits)', async () => {
    const roundBytes = 8
    const rounds = 5
    const raw = prngBytes(roundBytes * rounds, 9)
    const { ticks, receipt } = await drive(
      broadcast(RATE, batchSource('s', raw, 8), { mode: 'xor', rounds, roundBytes }),
    )
    expect(ticks.length).toBe(rounds)
    const output = concat(ticks)
    const expected = await collect(xorImprint(raw, RATE))
    expect([...output]).toEqual([...expected])
    // one inverse pass over the stored output recovers the raw bytes
    expect([...(await collect(xorImprint(output, RATE)))]).toEqual([...raw])
    expect(receipt.bytesConsumed).toBe(roundBytes * rounds)
    expect(receipt.rounds).toBe(rounds)
    expect(receipt.outputHash).toBe(toHex(new Sha256().update(output).digest()))
  })

  test('mask mode continues the keystream across rounds; phase mode is deterministic', async () => {
    const { ticks } = await drive(
      broadcast(RATE, cyclingSource('u', prngBytes(256, 1)), {
        mode: 'mask',
        rounds: 3,
        roundBytes: 4,
      }),
    )
    const mask = concat(ticks)
    for (let j = 3; j < mask.length; j++) expect(mask[j]).toBe(mask[j - 3] as number)
    const phase = async () =>
      concat(
        (
          await drive(
            broadcast(RATE, cyclingSource('u', prngBytes(256, 2)), {
              mode: 'phase',
              rounds: 4,
              roundBytes: 5,
            }),
          )
        ).ticks,
      )
    expect([...(await phase())]).toEqual([...(await phase())])
  })
})

describe('broadcast — resonance tally', () => {
  test('fires exactly on the configured value', async () => {
    const raw = Uint8Array.from([1, 0, 0, 0, 2, 0, 0, 0])
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
  const src = () => cyclingSource('u', prngBytes(4096, 1))

  test('a Rate or rate string has no witness; signatures and witnesses do', async () => {
    const rated = await drive(broadcast(RATE, src(), { rounds: 3, roundBytes: 8 }))
    expect(rated.receipt.witnessHash).toBeUndefined()
    expect(rated.receipt.witnessKind).toBeUndefined()
    expect(rated.receipt.target).toBe('12-33-7')
    expect(rated.receipt.v).toBe(2)
    expect(rated.receipt.mode).toBe('xor')

    const rateString = await drive(broadcast('12-33-7', src(), { rounds: 1, roundBytes: 8 }))
    expect(rateString.receipt.witnessHash).toBeUndefined()

    const signed = await drive(broadcast('Jane Roe', src(), { rounds: 3, roundBytes: 8 }))
    expect(signed.receipt.witnessHash).toBe(await sha256Hex('Jane Roe'))
    expect(signed.receipt.witnessKind).toBe('signature')

    const witnessed = await drive(
      broadcast({ name: 'subject', signature: 'hair-sample', kind: 'sample' }, src(), {
        rounds: 2,
        roundBytes: 8,
      }),
    )
    expect(witnessed.receipt.witnessHash).toBe(await sha256Hex('hair-sample'))
    expect(witnessed.receipt.witnessKind).toBe('sample')

    const named = await drive(
      broadcast({ name: 'subject', rate: RATE }, src(), { rounds: 1, roundBytes: 8 }),
    )
    expect(named.receipt.witnessKind).toBe('name')
  })

  test('an NFC-equivalent signature gives the same rate and witness hash', async () => {
    const nfc = `caf${String.fromCodePoint(0xe9)}`
    const nfd = `cafe${String.fromCodePoint(0x301)}`
    const a = await drive(broadcast(nfc, src(), { rounds: 1, roundBytes: 8, now: () => 0 }))
    const b = await drive(broadcast(nfd, src(), { rounds: 1, roundBytes: 8, now: () => 0 }))
    expect(b.receipt).toEqual(a.receipt)
  })

  test('unresolvable or invalid targets reject with invalid_target before any byte is read', async () => {
    let opened = 0
    const counting = {
      name: 'counting',
      async *stream() {
        opened++
        yield prngBytes(64, 1)
      },
    }
    for (const target of [
      {},
      '',
      { digits: [], base: 44 },
      { digits: [99], base: 44 },
      { digits: [1], base: 1 },
      { signature: '' },
      { name: 'n', kind: 'aura' },
    ]) {
      await expect(
        broadcast(target as never, counting, { rounds: 1 }).next(),
      ).rejects.toMatchObject({
        name: 'ScanError',
        code: 'invalid_target',
      })
    }
    expect(opened).toBe(0)
  })
})

describe('broadcast — error contract', () => {
  test('a health-test failure mid-run is source_error, never a clean receipt', async () => {
    const health = codedError('EntropyError', 'health_test', 'RCT failed: 42 repeated samples')
    const gen = broadcast(RATE, failingSource('esp32', health, 2, 16), {
      rounds: 1000,
      roundBytes: 16,
    })
    const error = await drive(gen).then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(error).toMatchObject({ name: 'ScanError', code: 'source_error', source: 'esp32' })
    expect((error as { cause?: unknown }).cause).toBe(health)
  })

  test('a raw I/O error and a non-byte chunk are source_error too', async () => {
    await expect(
      drive(
        broadcast(RATE, failingSource('serial', new Error('EIO: device disconnected'), 1), {
          rounds: 10,
        }),
      ),
    ).rejects.toMatchObject({ code: 'source_error' })
    const bad = {
      name: 'bad',
      async *stream() {
        yield new Uint8Array(16).fill(1)
        yield [1, 2, 3] as unknown as Uint8Array
      },
    }
    await expect(drive(broadcast(RATE, bad, { rounds: 10 }))).rejects.toMatchObject({
      code: 'source_error',
    })
  })

  test('only a source that ends stops the broadcast cleanly (partial round discarded)', async () => {
    const raw = prngBytes(8 * 3 + 5, 1)
    const { ticks, receipt } = await drive(
      broadcast(RATE, batchSource('s', raw, 8), { rounds: 1000, roundBytes: 8 }),
    )
    expect(ticks.length).toBe(3)
    expect(receipt.rounds).toBe(3)
    expect(receipt.bytesConsumed).toBe(29)
  })

  test('durationMs bounds the run via the injected clock', async () => {
    let t = 0
    const { ticks } = await drive(
      broadcast(RATE, cyclingSource('u', prngBytes(8192, 1)), {
        durationMs: 3,
        roundBytes: 8,
        now: () => t++,
      }),
    )
    expect(ticks.length).toBeGreaterThan(0)
    expect(ticks.length).toBeLessThan(10)
  })

  test('abort mid-stream rejects with aborted', async () => {
    const ac = new AbortController()
    const gen = broadcast(RATE, cyclingSource('u', prngBytes(8192, 1)), {
      rounds: 1000,
      roundBytes: 8,
      signal: ac.signal,
    })
    const first = await gen.next()
    expect(first.done).toBe(false)
    ac.abort()
    await expect(gen.next()).rejects.toMatchObject({ name: 'ScanError', code: 'aborted' })
  })
})

describe('broadcast — validation', () => {
  test('bad numeric options reject the first next() with invalid_options', async () => {
    const cases: Record<string, unknown>[] = [
      { resonanceOdds: 0 },
      { resonanceOdds: -5 },
      { resonanceOdds: 1.5 },
      { resonanceOdds: Number.NaN },
      { resonanceOdds: 2 ** 49 },
      { resonanceOdds: 6765.0001 },
      { resonanceOdds: 10, resonanceValue: 10 },
      { resonanceValue: -1 },
      { roundBytes: 0 },
      { roundBytes: -1 },
      { roundBytes: 1 }, // too small for one draw of the default odds 6765 (2 bytes)
      { rounds: 2.5 },
      { rounds: -1 },
      { durationMs: Number.NaN },
      { mode: 'loud' },
      { now: 5 },
    ]
    for (const opts of cases) {
      await expect(
        broadcast(RATE, cyclingSource('u', prngBytes(64, 1)), opts as never).next(),
      ).rejects.toMatchObject({ name: 'ScanError', code: 'invalid_options' })
    }
  })

  test('rounds: 0 yields nothing and opens nothing', async () => {
    let opened = 0
    const source = {
      name: 'lazy',
      async *stream() {
        opened++
        yield prngBytes(16, 1)
      },
    }
    const { ticks, receipt } = await drive(broadcast(RATE, source, { rounds: 0 }))
    expect(ticks.length).toBe(0)
    expect(receipt.rounds).toBe(0)
    expect(receipt.outputHash).toBe(toHex(new Sha256().digest()))
    expect(opened).toBe(0)
  })
})
