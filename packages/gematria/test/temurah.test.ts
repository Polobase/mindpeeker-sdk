import { describe, expect, test } from 'bun:test'
import { GematriaError } from '../src/errors.js'
import { achbi, albam, atbash, avgad, temurahShift } from '../src/temurah.js'
import { value } from '../src/value.js'

const FULL_ALEPHBET = 'אבגדהוזחטיכלמנסעפצקרשת'

describe('atbash', () => {
  test('substitutes aleph↔tav, bet↔shin, gimel↔resh', () => {
    expect(atbash('אבג')).toBe('תשר')
  })

  test('is an involution: atbash(atbash(x)) === x', () => {
    expect(atbash(atbash(FULL_ALEPHBET))).toBe(FULL_ALEPHBET)
    expect(atbash(atbash('תורה'))).toBe('תורה')
  })

  test('final forms fold to their base letter under substitution', () => {
    // 'שלום' ends in final mem (ם); a round trip returns base mem (מ).
    expect(atbash(atbash('שלום'))).toBe('שלומ')
  })

  test('the transformed string, valued as Hechrachi, equals the he-atbash cipher', () => {
    for (const word of ['אבג', 'שלום', 'תורה']) {
      expect(value(atbash(word), 'he-hechrachi')).toBe(value(word, 'he-atbash'))
    }
  })

  test('non-Hebrew characters pass through unchanged', () => {
    expect(atbash('א b ג')).toBe('ת b ר')
  })
})

describe('albam', () => {
  test('maps each letter i to (i+11) mod 22', () => {
    // aleph(0)→lamed(11), bet(1)→mem(12), gimel(2)→nun(13)
    expect(albam('אבג')).toBe('למנ')
  })

  test('is an involution: albam(albam(x)) === x', () => {
    expect(albam(albam(FULL_ALEPHBET))).toBe(FULL_ALEPHBET)
    expect(albam(albam('תורה'))).toBe('תורה')
  })

  test('the transformed string, valued as Hechrachi, equals the he-albam cipher', () => {
    for (const word of ['אבג', 'שלום']) {
      expect(value(albam(word), 'he-hechrachi')).toBe(value(word, 'he-albam'))
    }
  })
})

describe('avgad', () => {
  test('maps each letter to the next, cyclically (ת→א)', () => {
    expect(avgad('אבג')).toBe('בגד')
    expect(avgad('ת')).toBe('א')
  })

  test('applying it 22 times is the identity', () => {
    let s = FULL_ALEPHBET
    for (let i = 0; i < 22; i++) s = avgad(s)
    expect(s).toBe(FULL_ALEPHBET)
  })

  test('is temurahShift by 1', () => {
    expect(avgad(FULL_ALEPHBET)).toBe(temurahShift(FULL_ALEPHBET, 1))
  })
})

describe('achbi', () => {
  test('folds each half so that א↔י and ב↔ט', () => {
    expect(achbi('א')).toBe('י')
    expect(achbi('ב')).toBe('ט')
    expect(achbi('אב')).toBe('יט')
  })

  test('is an involution: achbi(achbi(x)) === x', () => {
    expect(achbi(achbi(FULL_ALEPHBET))).toBe(FULL_ALEPHBET)
    expect(achbi(achbi('שלום'))).toBe('שלומ')
  })

  test('holds the eleventh letter of each half (כ, ת) fixed', () => {
    expect(achbi('כ')).toBe('כ')
    expect(achbi('ת')).toBe('ת')
  })
})

describe('temurahShift', () => {
  test('shift by 11 equals Albam', () => {
    expect(temurahShift(FULL_ALEPHBET, 11)).toBe(albam(FULL_ALEPHBET))
  })

  test('a shift and its negative round-trip', () => {
    for (const n of [1, 5, 13, 21, -4]) {
      expect(temurahShift(temurahShift('תורה', n), -n)).toBe('תורה')
    }
  })

  test('non-Hebrew characters pass through unchanged', () => {
    expect(temurahShift('א b ג', 1)).toBe('ב b ד')
  })

  test('rejects a non-finite shift', () => {
    expect(() => temurahShift('א', Number.NaN)).toThrow(GematriaError)
  })
})
