import { describe, expect, test } from 'bun:test'
import { GematriaError } from '../src/errors.js'
import { achbi, aibat, albam, atbash, avgad, temurahShift } from '../src/temurah.js'
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
  // Mathers/Ginsburg: Achbi (AKBI) pairs א↔כ, ב↔י; each half of eleven is
  // reversed onto itself, so ו (6th of the first half) and פ (6th of the second)
  // stay fixed.
  const PAIRS = 'אכ בי גט דח הז וו זה חד טג יב כא לת מש נר סק עצ פפ צע קס רנ שמ תל'

  test('reverses each half: א↔כ, ב↔י, … with ו and פ fixed', () => {
    for (const pair of PAIRS.split(' ')) {
      const [from, to] = [...pair] as [string, string]
      expect(achbi(from)).toBe(to)
    }
    expect(achbi(FULL_ALEPHBET)).toBe('כיטחזוהדגבאתשרקצפעסנמל')
  })

  test('is named by its first two pairs, A↔K and B↔I', () => {
    expect(achbi('אב')).toBe('כי')
    expect(achbi('ו')).toBe('ו')
    expect(achbi('פ')).toBe('פ')
    expect(achbi('ל')).toBe('ת')
  })

  test('is an involution: achbi(achbi(x)) === x', () => {
    expect(achbi(achbi(FULL_ALEPHBET))).toBe(FULL_ALEPHBET)
    expect(achbi(achbi('שלום'))).toBe('שלומ')
  })

  test('substitutes יהוה letter by letter', () => {
    expect(achbi('יהוה')).toBe('בזוז')
  })
})

describe('aibat (the 0.1.x achbi mapping)', () => {
  const PAIRS = 'אי בט גח דז הו וה זד חג טב יא ככ לש מר נק סצ עפ פע צס קנ רמ של תת'

  test('pairs א↔י, ב↔ט, … with כ and ת fixed', () => {
    for (const pair of PAIRS.split(' ')) {
      const [from, to] = [...pair] as [string, string]
      expect(aibat(from)).toBe(to)
    }
    expect(aibat(FULL_ALEPHBET)).toBe('יטחזוהדגבאכשרקצפעסנמלת')
  })

  test('is an involution', () => {
    expect(aibat(aibat(FULL_ALEPHBET))).toBe(FULL_ALEPHBET)
  })
})

describe('temurah input validation', () => {
  test('every substitution rejects a non-string with GematriaError invalid_input', () => {
    for (const fn of [atbash, albam, avgad, achbi, aibat]) {
      // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
      expect(() => fn(5 as any)).toThrow(expect.objectContaining({ code: 'invalid_input' }))
      // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
      expect(() => fn(undefined as any)).toThrow(GematriaError)
    }
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => temurahShift(undefined as any, 1)).toThrow(
      expect.objectContaining({ code: 'invalid_input' }),
    )
  })

  test('niqqud are stripped before substitution', () => {
    expect(atbash('אָב')).toBe('תש')
  })
})

describe('avgad anchor', () => {
  test('יהוה → כוזו (Sepher Sephiroth 39, "Metathesis of YHVH")', () => {
    expect(avgad('יהוה')).toBe('כוזו')
    expect(value('כוזו', 'he-hechrachi')).toBe(39)
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
