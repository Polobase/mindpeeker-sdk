import { describe, expect, test } from 'bun:test'
import * as api from '../src/index.js'
import * as lexicon from '../src/lexicon.js'
import * as oracle from '../src/oracle.js'

/** The public `.` barrel must stay a stable, complete surface. */
const ROOT_EXPORTS = [
  'ABGATH',
  'ACHBAZ',
  'ACHBI',
  'ADBAG',
  'AGDATH',
  'AHBAD',
  'AIBAT',
  'ALBACH',
  'ALBATH',
  'ALIASES',
  'AMBAL',
  'ANBAM',
  'AOBAS',
  'APBAO',
  'AQBATZ',
  'ARABIC_CIPHERS',
  'ARBAQ',
  'ASBAN',
  'ASHBAR',
  'ATBACH',
  'ATHBASH',
  'ATZBAP',
  'AVBAH',
  'AZBAV',
  'CIPHERS',
  'CIPHERS_BY_SCRIPT',
  'ENGLISH_CIPHERS',
  'GREEK_CIPHERS',
  'GematriaError',
  'HEBREW_CIPHERS',
  'HEBREW_FINALS',
  'HE_BASE',
  'HE_NAMES',
  'MAX_HEBREW_NUMERAL',
  'MAX_NUMBER',
  'NINE_CHAMBERS',
  'NUMERAL_CIPHERS',
  'TZIRUPH_TABLES',
  'achbi',
  'acronym',
  'admissibleWords',
  'aibat',
  'aiqBeker',
  'aiqBekerEquivalent',
  'aiqBekerSubstitute',
  'albam',
  'analyze',
  'atbash',
  'avgad',
  'birthdayBound',
  'chamberMates',
  'chamberReduce',
  'cipherFromId',
  'clearDefaultLexicon',
  'collisionProfile',
  'createLexiconRegistry',
  'detectScript',
  'digitRoot',
  'equalValue',
  'expectedMatches',
  'getCipher',
  'getDefaultLexicon',
  'heIndex',
  'letterValues',
  'lookup',
  'matches',
  'milui',
  'normalizeFor',
  'notariqon',
  'numberProperties',
  'pairMatchTest',
  'profile',
  'reduce',
  'resolveCipherId',
  'temurahShift',
  'toHebrewNumeral',
  'tziruph',
  'tziruphSquare',
  'useDefaultLexicon',
  'value',
]

describe('public api surface', () => {
  test('the root exports exactly the documented runtime names', () => {
    expect(Object.keys(api).sort()).toEqual([...ROOT_EXPORTS].sort())
  })

  test('the subpaths export exactly their documented runtime names', () => {
    expect(Object.keys(oracle).sort()).toEqual([
      'castByValue',
      'castGematria',
      'drawByValue',
      'drawWord',
    ])
    expect(Object.keys(lexicon).sort()).toEqual([
      'FAMOUS_NUMBERS',
      'SCRIPT_CIPHER',
      'SEPHER_SEPHIROTH',
      'defaultLexicon',
    ])
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
