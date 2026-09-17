import { describe, expect, test } from 'bun:test'
import { GEOMANTIC_FIGURES } from '../../../src/systems/geomancy/data.js'
import { ODU_FIGURES, oduFromBinary } from '../../../src/systems/ifa/data.js'

// Bascom, Ifa Divination (1969), Table 3: marks top → bottom, 1 = single, 2 = double.
const IFE = [
  ['Ogbe', '1111'],
  ['Oyeku', '2222'],
  ['Iwori', '2112'],
  ['Edi', '1221'],
  ['Obara', '1222'],
  ['Okanran', '2221'],
  ['Irosun', '1122'],
  ['Owonrin', '2211'],
  ['Ogunda', '1112'],
  ['Osa', '2111'],
  ['Irete', '1121'],
  ['Otura', '1211'],
  ['Oturupon', '2212'],
  ['Ika', '2122'],
  ['Ose', '1212'],
  ['Ofun', '2121'],
] as const
const SOUTHWESTERN = [
  'Ogbe',
  'Oyeku',
  'Iwori',
  'Edi',
  'Irosun',
  'Owonrin',
  'Obara',
  'Okanran',
  'Ogunda',
  'Osa',
  'Ika',
  'Oturupon',
  'Otura',
  'Irete',
  'Ose',
  'Ofun',
]

describe('Ifá principal odu', () => {
  test('Bascom Table 3 A: Ifẹ order and marks (1 = single → "1", 2 = double → "0")', () => {
    expect(ODU_FIGURES.map((f) => f.name)).toEqual(IFE.map(([name]) => name))
    IFE.forEach(([name, code], i) => {
      const figure = ODU_FIGURES[i]
      expect(figure?.binary).toBe(code.replaceAll('2', '0'))
      expect(figure?.rank.ife).toBe(i + 1)
      expect(oduFromBinary(figure?.binary as string)?.name).toBe(name)
    })
  })

  test('Bascom Table 3 B: the southwestern (dominant) rank order', () => {
    const bySouthwestern = [...ODU_FIGURES].sort(
      (a, b) => a.rank.southwestern - b.rank.southwestern,
    )
    expect(bySouthwestern.map((f) => f.name)).toEqual(SOUTHWESTERN)
  })

  test('all 16 four-mark patterns exactly once — the same shapes as the geomantic figures', () => {
    expect(new Set(ODU_FIGURES.map((f) => f.binary)).size).toBe(16)
    expect(new Set(ODU_FIGURES.map((f) => f.id)).size).toBe(16)
    expect(new Set(ODU_FIGURES.map((f) => f.binary))).toEqual(
      new Set(GEOMANTIC_FIGURES.map((f) => f.binary)),
    )
    expect(oduFromBinary('11111')).toBeUndefined()
  })

  test('Yoruba spellings keep Bascom subdots; table is deeply frozen', () => {
    expect(ODU_FIGURES.map((f) => f.yoruba).filter((y, i) => y !== ODU_FIGURES[i]?.name)).toEqual([
      'Ọyẹku',
      'Ọbara',
      'Ọkanran',
      'Ọwọnrin',
      'Ọsa',
      'Irẹtẹ',
      'Oturupọn',
      'Ọṣẹ',
    ])
    expect(Object.isFrozen(ODU_FIGURES)).toBe(true)
    expect(Object.isFrozen(ODU_FIGURES[0])).toBe(true)
    expect(Object.isFrozen(ODU_FIGURES[0]?.rank)).toBe(true)
  })
})
