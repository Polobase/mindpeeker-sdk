import { describe, expect, test } from 'bun:test'
import { aiqBeker, chamberReduce, NINE_CHAMBERS } from '../src/chambers.js'
import { GematriaError } from '../src/errors.js'
import { value } from '../src/value.js'

describe('NINE_CHAMBERS', () => {
  test('is nine deeply frozen triads over the 22 + 5 final letters', () => {
    expect(NINE_CHAMBERS.length).toBe(9)
    expect(Object.isFrozen(NINE_CHAMBERS)).toBe(true)
    const all = NINE_CHAMBERS.flat()
    expect(all.length).toBe(27)
    expect(new Set(all).size).toBe(27)
    for (const row of NINE_CHAMBERS) {
      expect(Object.isFrozen(row)).toBe(true)
      expect(row.length).toBe(3)
    }
  })

  test('the first chambers are the classic aleph/yod/qoph, bet/kaph/resh triads', () => {
    expect(NINE_CHAMBERS[0]).toEqual(['א', 'י', 'ק'])
    expect(NINE_CHAMBERS[1]).toEqual(['ב', 'כ', 'ר'])
    expect(NINE_CHAMBERS[3]).toEqual(['ד', 'מ', 'ת'])
  })
})

describe('aiqBeker', () => {
  test('returns the 1..9 chamber and 1..3 position of a letter', () => {
    expect(aiqBeker('א')).toEqual({ chamber: 1, position: 1 })
    expect(aiqBeker('י')).toEqual({ chamber: 1, position: 2 })
    expect(aiqBeker('ק')).toEqual({ chamber: 1, position: 3 })
    expect(aiqBeker('ב')).toEqual({ chamber: 2, position: 1 })
  })

  test('final forms are distinct members (they occupy the hundreds slot)', () => {
    expect(aiqBeker('כ')).toEqual({ chamber: 2, position: 2 })
    expect(aiqBeker('ך')).toEqual({ chamber: 5, position: 3 })
    expect(aiqBeker('ץ')).toEqual({ chamber: 9, position: 3 })
  })

  test('strips niqqud and rejects non-Hebrew input', () => {
    expect(aiqBeker('אָ')).toEqual({ chamber: 1, position: 1 })
    expect(() => aiqBeker('a')).toThrow(GematriaError)
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => aiqBeker(5 as any)).toThrow(GematriaError)
  })
})

describe('chamberReduce', () => {
  test('is the theosophical reduction (digital root) to a single digit', () => {
    expect(chamberReduce(100)).toBe(1)
    expect(chamberReduce(666)).toBe(9)
    expect(chamberReduce(0)).toBe(0)
  })

  test('every letter of a chamber reduces to the same digit', () => {
    for (const row of NINE_CHAMBERS) {
      const reduced = row.map((ch) => chamberReduce(value(ch, 'he-gadol')))
      expect(new Set(reduced).size).toBe(1)
    }
  })

  test('rejects negatives and non-integers', () => {
    expect(() => chamberReduce(-1)).toThrow(GematriaError)
    expect(() => chamberReduce(1.5)).toThrow(GematriaError)
  })
})
