import { describe, expect, test } from 'bun:test'
import { HE_BASE, HE_NAMES, HEBREW_CIPHERS, heIndex, milui } from '../../src/ciphers/hebrew.js'
import { value } from '../../src/value.js'

describe('hebrew tables', () => {
  test('exposes the 22 base letters aleph → tav', () => {
    expect(HE_BASE.length).toBe(22)
    expect(HE_BASE[0]).toBe('א')
    expect(HE_BASE[21]).toBe('ת')
  })

  test('every cipher is deeply frozen with a complete table', () => {
    for (const c of HEBREW_CIPHERS) {
      expect(Object.isFrozen(c)).toBe(true)
      expect(Object.isFrozen(c.table)).toBe(true)
      for (const row of c.table) expect(Object.isFrozen(row)).toBe(true)
      // Gadol distinguishes the 5 final forms; the rest use the 22 base letters.
      expect(c.table.length).toBe(c.id === 'he-gadol' ? 27 : 22)
    }
  })

  test('Hechrachi is the canonical aleph=1 … tav=400 ladder', () => {
    const std = HEBREW_CIPHERS.find((c) => c.id === 'he-hechrachi')?.table ?? []
    const values = std.map((r) => r.value)
    expect(values).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 200, 300, 400,
    ])
  })

  test('final forms fold to base in every method except Gadol', () => {
    // final mem (ם) folds to mem (מ) = 40 in standard, but is 600 in Gadol.
    expect(value('ם', 'he-hechrachi')).toBe(40)
    expect(value('ם', 'he-siduri')).toBe(13)
    expect(value('ם', 'he-katan')).toBe(4)
    expect(value('ם', 'he-gadol')).toBe(600)
  })

  test('Gadol assigns 500–900 to the five finals', () => {
    expect(value('ךםןףץ', 'he-gadol')).toBe(500 + 600 + 700 + 800 + 900)
  })

  test('Siduri is the 1..22 ordinal', () => {
    expect(value('א', 'he-siduri')).toBe(1)
    expect(value('ת', 'he-siduri')).toBe(22)
    expect(value('כ', 'he-siduri')).toBe(11)
  })

  test('Katan is the per-letter digital root', () => {
    // qof=100→1, resh=200→2, shin=300→3, tav=400→4
    expect(value('קרשת', 'he-katan')).toBe(1 + 2 + 3 + 4)
  })

  test('Atbash pairs aleph↔tav, bet↔shin', () => {
    expect(value('א', 'he-atbash')).toBe(400)
    expect(value('ת', 'he-atbash')).toBe(1)
    expect(value('ב', 'he-atbash')).toBe(300)
  })

  test('heIndex folds finals and rejects non-Hebrew', () => {
    expect(heIndex('א')).toBe(0)
    expect(heIndex('ם')).toBe(heIndex('מ'))
    expect(heIndex('a')).toBe(-1)
  })
})

describe('extended Hebrew methods', () => {
  test('the five Miluim ciphers are flagged extended and are 22-letter tables', () => {
    for (const id of ['he-milui', 'he-kidmi', 'he-perati', 'he-neelam', 'he-katan-mispari']) {
      const c = HEBREW_CIPHERS.find((x) => x.id === id)
      expect(c?.extended).toBe(true)
      expect(c?.table.length).toBe(22)
      expect(Object.isFrozen(c)).toBe(true)
    }
  })

  test('Milui (full spelling): each letter = the value of its spelled-out name', () => {
    // aleph אלף = 111, bet בית = 412 → av אב = 523
    expect(value('א', 'he-milui')).toBe(111)
    expect(value('ב', 'he-milui')).toBe(412)
    expect(value('אב', 'he-milui')).toBe(523)
    // spot-check the standard name table against its own Hechrachi value
    expect(value(HE_NAMES.א as string, 'he-hechrachi')).toBe(111)
    expect(value(HE_NAMES.ש as string, 'he-hechrachi')).toBe(360)
  })

  test('milui() anchors the four Miluim of the Tetragrammaton exactly', () => {
    expect(milui('יהוה', 'ab')).toBe(72)
    expect(milui('יהוה', 'sag')).toBe(63)
    expect(milui('יהוה', 'mah')).toBe(45)
    expect(milui('יהוה', 'ban')).toBe(52)
    // the default standard table coincides with BAN for he/vav
    expect(milui('יהוה')).toBe(52)
    expect(milui('יהוה')).toBe(value('יהוה', 'he-milui'))
  })

  test('Kidmi (triangular): the running Hechrachi sum, finals folding to base', () => {
    expect(value('א', 'he-kidmi')).toBe(1)
    expect(value('ב', 'he-kidmi')).toBe(3)
    expect(value('ה', 'he-kidmi')).toBe(15)
    expect(value('י', 'he-kidmi')).toBe(55)
    expect(value('ת', 'he-kidmi')).toBe(1495)
    expect(value('ם', 'he-kidmi')).toBe(value('מ', 'he-kidmi')) // 145
  })

  test('Perati (squared): each letter is its Hechrachi value squared', () => {
    expect(value('א', 'he-perati')).toBe(1)
    expect(value('י', 'he-perati')).toBe(100)
    expect(value('כ', 'he-perati')).toBe(400)
    expect(value('ק', 'he-perati')).toBe(10000)
    expect(value('ת', 'he-perati')).toBe(160000)
  })

  test('Neelam (hidden): milui(letter) − hechrachi(letter)', () => {
    expect(value('א', 'he-neelam')).toBe(111 - 1)
    expect(value('ב', 'he-neelam')).toBe(412 - 2)
  })

  test('Katan Mispari (integral): the digital root of the whole-word total', () => {
    // YHVH Hechrachi = 26 → digital root 8 (word-level, not per-letter)
    expect(value('יהוה', 'he-katan-mispari')).toBe(8)
    // אמת Hechrachi = 441 → 4+4+1 = 9
    expect(value('אמת', 'he-katan-mispari')).toBe(9)
    // distinct from per-letter Katan on a word where they diverge
    expect(value('יהוה', 'he-katan')).not.toBe(value('יהוה', 'he-katan-mispari'))
  })
})
