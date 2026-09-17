import { describe, expect, test } from 'bun:test'
import { OracleError } from '../../../src/errors.js'
import { castShield } from '../../../src/systems/geomancy/cast.js'
import {
  HOUSE_SYSTEMS,
  houses,
  partOfFortune,
  reconciler,
} from '../../../src/systems/geomancy/chart.js'
import { prngBytes } from '../../helpers/byte-sources.js'

const names = (figures: readonly { name: string }[]) => figures.map((f) => f.name)

const codeOf = (fn: () => unknown): string => {
  try {
    fn()
    return 'no-throw'
  } catch (err) {
    expect(err).toBeInstanceOf(OracleError)
    return (err as OracleError).code
  }
}

describe('Liber XCVI worked chart (Crowley, Equinox I:2, 1909, ch. II–III — public domain)', () => {
  // The printed example: 16 lines of dashes with counts 10 11 10 10 | 12 6 9 7 |
  // 15 16 15 14 | 15 15 16 14 → Mothers t v s | in the Liber XCVI glyph font, i.e.
  // Fortuna Minor 1100, Amissio 1010, Fortuna Major 0011, Rubeus 0100.
  // As 16 MSB-first bits: 1100 1010 0011 0100 = 0xCA 0x34.
  const bytes = new Uint8Array([0xca, 0x34])

  test('every printed figure I–XV is reproduced', async () => {
    const chart = await castShield(bytes)
    expect(names(chart.mothers)).toEqual(['Fortuna Minor', 'Amissio', 'Fortuna Major', 'Rubeus'])
    expect(names(chart.daughters)).toEqual(['Fortuna Minor', 'Carcer', 'Conjunctio', 'Albus'])
    expect(names(chart.nephews)).toEqual(['Conjunctio', 'Caput Draconis', 'Acquisitio', 'Rubeus'])
    expect(names(chart.witnesses)).toEqual(['Tristitia', 'Tristitia'])
    expect(chart.judge.name).toBe('Populus')
  })

  test('Part of Fortune: I + II + … + XII = 74 points = 6 × 12 + 2 → figure II', async () => {
    const chart = await castShield(bytes)
    const pof = partOfFortune(chart)
    expect(pof.total).toBe(74)
    expect(pof.index).toBe(2)
    expect(pof.figure.name).toBe('Amissio')
    expect(Object.isFrozen(pof)).toBe(true)
  })

  test('Reconciler = I + XV: Fortuna Minor + Populus = Fortuna Minor', async () => {
    expect(reconciler(await castShield(bytes)).name).toBe('Fortuna Minor')
  })

  test('ch. III house placement: I 10th, II Asc., III 4th, … XII 9th', async () => {
    const chart = await castShield(bytes)
    const gd = houses(chart, { system: 'goldenDawn' })
    // Hand-placed from the ch. III table: house h ← figure at that house.
    expect(names(gd)).toEqual([
      'Amissio', // 1 ← II
      'Carcer', // 2 ← VI
      'Caput Draconis', // 3 ← X
      'Fortuna Major', // 4 ← III
      'Conjunctio', // 5 ← VII
      'Acquisitio', // 6 ← XI
      'Rubeus', // 7 ← IV
      'Albus', // 8 ← VIII
      'Rubeus', // 9 ← XII
      'Fortuna Minor', // 10 ← I
      'Fortuna Minor', // 11 ← V
      'Conjunctio', // 12 ← IX
    ])
  })
})

describe('houses', () => {
  test('sequential (default): Mothers 1-4, Daughters 5-8, Nephews 9-12', async () => {
    const cast = await castShield(prngBytes(2, 0x40e))
    for (const chart of [houses(cast), houses(cast, { system: 'sequential' })]) {
      expect(chart.length).toBe(12)
      expect(chart.slice(0, 4)).toEqual([...cast.mothers])
      expect(chart.slice(4, 8)).toEqual([...cast.daughters])
      expect(chart.slice(8, 12)).toEqual([...cast.nieces])
      expect(Object.isFrozen(chart)).toBe(true)
    }
  })

  test('both systems are permutations of 1..12; goldenDawn puts Mothers angular', () => {
    for (const placement of Object.values(HOUSE_SYSTEMS)) {
      expect([...placement].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    }
    expect(HOUSE_SYSTEMS.goldenDawn.slice(0, 4)).toEqual([10, 1, 4, 7]) // angular
    expect(HOUSE_SYSTEMS.goldenDawn.slice(4, 8)).toEqual([11, 2, 5, 8]) // succedent
    expect(HOUSE_SYSTEMS.goldenDawn.slice(8, 12)).toEqual([12, 3, 6, 9]) // cadent
    expect(Object.isFrozen(HOUSE_SYSTEMS.goldenDawn)).toBe(true)
  })

  test('accepts a JSON round-tripped shield', async () => {
    const cast = await castShield(new Uint8Array([0xca, 0x34]))
    const revived = JSON.parse(JSON.stringify(cast))
    expect(houses(revived, { system: 'goldenDawn' })).toEqual(
      houses(cast, { system: 'goldenDawn' }),
    )
    expect(partOfFortune(revived).total).toBe(74)
    expect(reconciler(revived)).toBe(reconciler(cast))
  })

  test('invalid systems, options, and shields throw invalid_input', async () => {
    const cast = await castShield(prngBytes(2, 1))
    for (const system of ['placidus', 'constructor', '__proto__', 42, null]) {
      expect(codeOf(() => houses(cast, { system: system as never }))).toBe('invalid_input')
    }
    expect(codeOf(() => houses(cast, null as never))).toBe('invalid_input')
    const bad: unknown[] = [
      null,
      42,
      {},
      { ...cast, mothers: cast.mothers.slice(0, 3) },
      { ...cast, nieces: [...cast.nieces.slice(0, 3), { binary: '2222' }] },
      { ...cast, judge: undefined },
    ]
    for (const shield of bad) {
      expect(codeOf(() => houses(shield as never))).toBe('invalid_input')
      expect(codeOf(() => reconciler(shield as never))).toBe('invalid_input')
      expect(codeOf(() => partOfFortune(shield as never))).toBe('invalid_input')
    }
  })
})

describe('exhaustive over all 2^16 charts (independent bit arithmetic)', () => {
  test('reconciler = Mother I XOR Judge; Part of Fortune total, index, and parity', async () => {
    const indexCounts = new Array<number>(13).fill(0)
    for (let v = 0; v < 65_536; v++) {
      // Independent derivation straight from the 16 bits.
      const m = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((r) => (v >>> (15 - 4 * i - r)) & 1))
      const d = [0, 1, 2, 3].map((k) => [0, 1, 2, 3].map((r) => (m[r] as number[])[k] as number))
      const xor = (a: number[], b: number[]) => a.map((x, r) => x ^ (b[r] as number))
      const n = [
        xor(m[0] as number[], m[1] as number[]),
        xor(m[2] as number[], m[3] as number[]),
        xor(d[0] as number[], d[1] as number[]),
        xor(d[2] as number[], d[3] as number[]),
      ]
      const judge = xor(
        xor(n[0] as number[], n[1] as number[]),
        xor(n[2] as number[], n[3] as number[]),
      )
      const total = [...m, ...d, ...n].reduce((s, rows) => s + 8 - rows.reduce((a, b) => a + b), 0)

      const cast = await castShield(new Uint8Array([v >>> 8, v & 0xff]))
      expect(reconciler(cast).binary).toBe(xor(m[0] as number[], judge).join(''))
      const pof = partOfFortune(cast)
      expect(pof.total).toBe(total)
      expect(pof.index).toBe(total % 12 === 0 ? 12 : total % 12)
      expect(pof.figure).toBe(houses(cast)[pof.index - 1] as never)
      indexCounts[pof.index] = (indexCounts[pof.index] as number) + 1
    }
    // Parity theorem: the total is always even, so only even figures are reachable.
    expect(indexCounts.map((c, i) => (c > 0 ? i : 0)).filter((i) => i > 0)).toEqual([
      2, 4, 6, 8, 10, 12,
    ])
  })
})
