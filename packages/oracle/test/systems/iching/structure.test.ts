import { describe, expect, test } from 'bun:test'
import { OracleError } from '../../../src/errors.js'
import { HEXAGRAMS, type Hexagram } from '../../../src/systems/iching/data.js'
import {
  fuXiNumber,
  hexagramFromFuXi,
  inverseHexagram,
  nuclearHexagram,
  oppositeHexagram,
} from '../../../src/systems/iching/structure.js'

const kw = (n: number): Hexagram => HEXAGRAMS[n - 1] as Hexagram

const codeOf = (fn: () => unknown): string => {
  try {
    fn()
    return 'no-throw'
  } catch (err) {
    expect(err).toBeInstanceOf(OracleError)
    return (err as OracleError).code
  }
}

describe('nuclear, inverse, opposite', () => {
  test('hand-checked values', () => {
    expect(nuclearHexagram(kw(1)).kingWen).toBe(1)
    expect(nuclearHexagram(kw(2)).kingWen).toBe(2)
    expect(nuclearHexagram(kw(63)).kingWen).toBe(64) // 101010 → lines 2-4 010, 3-5 101
    expect(nuclearHexagram(kw(64)).kingWen).toBe(63)
    expect(inverseHexagram(kw(11)).kingWen).toBe(12) // 111000 ↔ 000111
    expect(inverseHexagram(kw(29)).kingWen).toBe(29) // self-inverse
    expect(oppositeHexagram(kw(29)).kingWen).toBe(30)
    expect(oppositeHexagram(kw(1)).kingWen).toBe(2)
  })

  test('all 64: nuclear has 16 images; nuclear∘nuclear ∈ {1, 2, 63, 64} by lines 3-4', () => {
    const images = new Set<number>()
    for (const h of HEXAGRAMS) {
      const once = nuclearHexagram(h)
      images.add(once.kingWen)
      const b3b4 = h.binary.slice(2, 4)
      const expected = { '00': 2, '11': 1, '10': 63, '01': 64 }[b3b4]
      expect(nuclearHexagram(once).kingWen).toBe(expected as number)
    }
    expect(images.size).toBe(16)
  })

  test('all 64: inverse and opposite are involutions and commute', () => {
    for (const h of HEXAGRAMS) {
      expect(inverseHexagram(inverseHexagram(h))).toBe(h)
      expect(oppositeHexagram(oppositeHexagram(h))).toBe(h)
      expect(oppositeHexagram(h)).not.toBe(h)
      expect(inverseHexagram(oppositeHexagram(h))).toBe(oppositeHexagram(inverseHexagram(h)))
    }
    // Exactly 8 hexagrams are self-inverse (palindromic line strings).
    expect(HEXAGRAMS.filter((h) => inverseHexagram(h) === h).length).toBe(8)
  })

  test('accept JSON round-tripped hexagrams; reject anything else', () => {
    const revived = JSON.parse(JSON.stringify(kw(3))) as Hexagram
    expect(inverseHexagram(revived).kingWen).toBe(4)
    for (const bad of [null, 42, {}, { binary: '1111111' }, { binary: 63 }]) {
      for (const fn of [nuclearHexagram, inverseHexagram, oppositeHexagram, fuXiNumber]) {
        expect(codeOf(() => fn(bad as never))).toBe('invalid_input')
      }
    }
  })
})

describe('Fu Xi (Shao Yong) binary numbering', () => {
  // The traditional "Earlier Heaven" sequence, Qian first … Kun last, by title.
  const SEQUENCE =
    '乾 夬 大有 大壯 小畜 需 大畜 泰 履 兌 睽 歸妹 中孚 節 損 臨 ' +
    '同人 革 離 豐 家人 既濟 賁 明夷 無妄 隨 噬嗑 震 益 屯 頤 復 ' +
    '姤 大過 鼎 恆 巽 井 蠱 升 訟 困 未濟 解 渙 坎 蒙 師 ' +
    '遯 咸 旅 小過 漸 蹇 艮 謙 否 萃 晉 豫 觀 比 剝 坤'

  test('position p (1-based) in the traditional sequence has number 64 - p', () => {
    const titles = SEQUENCE.split(' ')
    expect(titles.length).toBe(64)
    titles.forEach((zh, i) => {
      const h = HEXAGRAMS.find((x) => x.name.zh === zh) as Hexagram
      expect(h).toBeDefined()
      expect(fuXiNumber(h)).toBe(64 - (i + 1))
    })
  })

  test('Kun 0, Bo 1, Bi 2, Guan 3, Qian 63; hexagramFromFuXi inverts', () => {
    expect(fuXiNumber(kw(2))).toBe(0)
    expect(fuXiNumber(kw(23))).toBe(1)
    expect(fuXiNumber(kw(8))).toBe(2)
    expect(fuXiNumber(kw(20))).toBe(3)
    expect(fuXiNumber(kw(1))).toBe(63)
    const seen = new Set<number>()
    for (let n = 0; n < 64; n++) {
      const h = hexagramFromFuXi(n)
      expect(fuXiNumber(h)).toBe(n)
      seen.add(h.kingWen)
    }
    expect(seen.size).toBe(64)
    for (const bad of [-1, 64, 1.5, Number.NaN]) {
      expect(codeOf(() => hexagramFromFuXi(bad))).toBe('invalid_input')
    }
  })
})
