import { describe, expect, test } from 'bun:test'
import * as api from '../src/index.js'

/** The public `.` barrel must stay a stable, complete surface. */
describe('public api surface', () => {
  test('exports every documented function and value', () => {
    for (const name of [
      'value',
      'analyze',
      'profile',
      'letterValues',
      'reduce',
      'atbash',
      'albam',
      'notariqon',
      'matches',
      'lookup',
      'equalValue',
      'detectScript',
      'normalizeFor',
      'digitRoot',
      'CIPHERS',
      'CIPHERS_BY_SCRIPT',
      'cipherFromId',
      'getCipher',
      'ALIASES',
      'resolveCipherId',
      'GematriaError',
      'HEBREW_FINALS',
      'HEBREW_CIPHERS',
      'GREEK_CIPHERS',
      'ENGLISH_CIPHERS',
      'HE_BASE',
      'heIndex',
    ]) {
      expect(api).toHaveProperty(name)
    }
  })

  test('the barrel does not pull the oracle bridge (stays zero-dep)', () => {
    expect(api).not.toHaveProperty('drawWord')
    expect(api).not.toHaveProperty('castGematria')
    expect(api).not.toHaveProperty('castByValue')
  })

  test('a round trip through the barrel computes the classic 13 = 13', () => {
    expect(api.value('אחד', 'he-hechrachi')).toBe(api.value('אהבה', 'he-hechrachi'))
  })
})
