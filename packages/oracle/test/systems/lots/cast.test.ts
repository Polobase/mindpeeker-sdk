import { describe, expect, test } from 'bun:test'
import type { OracleError } from '../../../src/errors.js'
import { castLot, JIAOBEI_WEIGHTS } from '../../../src/systems/lots/cast.js'

describe('castLot (kau cim)', () => {
  test('100 sticks: byte 0 → lot 1, 199 → 100, 200 rejected', async () => {
    const first = await castLot(new Uint8Array([0]))
    expect(first).toMatchObject({ sticks: 100, lot: 1, bytesConsumed: 1, bitsUsed: 8 })
    expect('confirmed' in first).toBe(false)
    expect(first.attempts).toEqual([{ lot: 1 }])
    expect((await castLot(new Uint8Array([199]))).lot).toBe(100)
    const rejected = await castLot(new Uint8Array([200, 7]))
    expect(rejected.lot).toBe(8)
    expect(rejected.bitsUsed).toBe(16)
  })

  test('confirm: shake again until a holy throw', async () => {
    // Stick byte 5 → lot 6; throw bits 10 → v = 2 → twoFlat; stick 7 → lot 8; bits 00 → holy.
    const cast = await castLot(new Uint8Array([5, 0b1000_0000, 7, 0]), { confirm: true })
    expect(cast.attempts).toEqual([
      { lot: 6, blocks: 'twoFlat' },
      { lot: 8, blocks: 'holy' },
    ])
    expect(cast.lot).toBe(8)
    expect(cast.confirmed).toBe(true)
    expect(cast.bytesConsumed).toBe(4)
    expect(cast.bitsUsed).toBe(8 + 2 + 8 + 2)
  })

  test('confirm: m stops after m sticks; unconfirmed casts keep the last stick', async () => {
    const cast = await castLot(new Uint8Array([5, 0xff, 9, 0xff, 1, 0]), { confirm: 2 })
    expect(cast.attempts.map((a) => a.blocks)).toEqual(['twoRound', 'twoRound'])
    expect(cast.lot).toBe(10)
    expect(cast.confirmed).toBe(false)
    expect(cast.bytesConsumed).toBe(4)
  })

  test('exhaustive jiaobei: the four 2-bit values give holy, holy, twoFlat, twoRound', async () => {
    expect(JIAOBEI_WEIGHTS).toEqual([2, 1, 1])
    const throws = []
    for (let v = 0; v < 4; v++) {
      const cast = await castLot(new Uint8Array([0, v << 6]), { sticks: 64, confirm: 1 })
      throws.push(cast.attempts[0]?.blocks)
    }
    expect(throws).toEqual(['holy', 'holy', 'twoFlat', 'twoRound'])
  })

  test('exhaustive, 64 sticks, confirm: 2 — final lot uniform, P(confirmed) = 3/4', async () => {
    const lots = new Array<number>(65).fill(0)
    let confirmed = 0
    let total = 0
    for (let stick = 0; stick < 64; stick++) {
      for (let t1 = 0; t1 < 4; t1++) {
        for (let t2 = 0; t2 < 4; t2++) {
          // the second stick is a bijection of the first, so both branches cover 1..64 evenly
          const cast = await castLot(new Uint8Array([stick, t1 << 6, (stick + 17) % 64, t2 << 6]), {
            sticks: 64,
            confirm: 2,
          })
          lots[cast.lot] = (lots[cast.lot] as number) + 1
          if (cast.confirmed) confirmed++
          total++
        }
      }
    }
    expect(lots.slice(1).every((c) => c === 16)).toBe(true)
    expect(confirmed / total).toBe(3 / 4)
  })

  test('the stick sizes 78 and 60 draw 1..n exactly uniformly over accepted bytes', async () => {
    for (const sticks of [78, 60] as const) {
      const accepted = Math.floor(256 / sticks) * sticks
      const counts = new Array<number>(sticks + 1).fill(0)
      for (let v = 0; v < accepted; v++) {
        const lot = (await castLot(new Uint8Array([v]), { sticks })).lot
        counts[lot] = (counts[lot] as number) + 1
      }
      expect(counts.slice(1).every((c) => c === Math.floor(256 / sticks))).toBe(true)
    }
  })

  test('invalid sticks and confirm values throw invalid_input', async () => {
    const bad = [
      { sticks: 50 },
      { sticks: '100' },
      { confirm: 0 },
      { confirm: -1 },
      { confirm: 1.5 },
      { confirm: 'yes' },
      { confirm: null },
    ]
    for (const opts of bad) {
      try {
        await castLot(new Uint8Array(8), opts as never)
        expect.unreachable()
      } catch (err) {
        expect((err as OracleError).code).toBe('invalid_input')
      }
    }
  })
})
