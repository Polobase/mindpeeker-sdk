import { describe, expect, test } from 'bun:test'
import type { OracleError } from '../../../src/errors.js'
import { COWRIE_ODU, castCowries } from '../../../src/systems/cowries/cast.js'

describe('castCowries (Bascom, Sixteen Cowries, 1980)', () => {
  test('names by number of cowries mouth up, 0–16', () => {
    expect(COWRIE_ODU.map((o) => `${o.count} ${o.name}`)).toEqual([
      '0 Opira',
      '1 Okanran',
      '2 Eji Oko',
      '3 Ogunda',
      '4 Irosun',
      '5 Ose',
      '6 Obara',
      '7 Odi',
      '8 Eji Ogbe',
      '9 Osa',
      '10 Ofun',
      '11 Owonrin',
      '12 Ejila Sebora',
      '13 Ika',
      '14 Oturupon',
      '15 Ofun Kanran',
      '16 Irete',
    ])
    expect(Object.isFrozen(COWRIE_ODU[8])).toBe(true)
  })

  test('ways = binomial(16, k) (independent Pascal triangle), summing to 2^16', () => {
    let rowPascal = [1n]
    for (let n = 1; n <= 16; n++) {
      const next = [1n]
      for (let k = 1; k < n; k++) next.push((rowPascal[k - 1] as bigint) + (rowPascal[k] as bigint))
      next.push(1n)
      rowPascal = next
    }
    expect(COWRIE_ODU.map((o) => BigInt(o.ways))).toEqual(rowPascal)
    expect(COWRIE_ODU.reduce((s, o) => s + o.ways, 0)).toBe(65_536)
  })

  test('fixture: 0xF0 0x0F → 8 up (Eji Ogbe), 16 bits', async () => {
    const cast = await castCowries(new Uint8Array([0xf0, 0x0f]))
    expect(cast.up).toBe(8)
    expect(cast.odu.name).toBe('Eji Ogbe')
    expect(cast.shells.slice(0, 5)).toEqual([true, true, true, true, false])
    expect(cast.bytesConsumed).toBe(2)
    expect(cast.bitsUsed).toBe(16)
  })

  test('exhaustive over all 65 536 two-byte inputs: count k occurs exactly binomial(16, k) times', async () => {
    const counts = new Array<number>(17).fill(0)
    for (let v = 0; v < 65_536; v++) {
      const cast = await castCowries(new Uint8Array([v >>> 8, v & 0xff]))
      counts[cast.up] = (counts[cast.up] as number) + 1
    }
    expect(counts).toEqual(COWRIE_ODU.map((o) => o.ways))
  })

  test('only shells: 16 is accepted', async () => {
    expect((await castCowries(new Uint8Array(2), { shells: 16 })).up).toBe(0)
    for (const shells of [12, 21, '16', null]) {
      try {
        await castCowries(new Uint8Array(2), { shells: shells as never })
        expect.unreachable()
      } catch (err) {
        expect((err as OracleError).code).toBe('invalid_input')
      }
    }
  })
})
