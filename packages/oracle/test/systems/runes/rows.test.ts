import { describe, expect, test } from 'bun:test'
import { ELDER_FUTHARK } from '../../../src/systems/runes/data.js'
import {
  FUTHARKS,
  FUTHORC_28,
  FUTHORC_29,
  FUTHORC_33,
  RUNE_LAYOUTS,
  runeSet,
  YOUNGER_FUTHARK,
} from '../../../src/systems/runes/rows.js'

const ids = (row: readonly { id: string }[]) => row.map((r) => r.id)
const codePoints = (row: readonly { glyph: string }[]) =>
  row.map((r) => (r.glyph.codePointAt(0) as number).toString(16).toUpperCase())

describe('rune rows', () => {
  test('sizes, unique ids and glyphs, index = position, all frozen', () => {
    const sizes = { elder: 24, younger: 16, futhorc28: 28, futhorc29: 29, futhorc33: 33 }
    for (const [name, row] of Object.entries(FUTHARKS)) {
      expect(row.length).toBe(sizes[name as keyof typeof sizes])
      expect(new Set(ids(row)).size).toBe(row.length)
      expect(new Set(row.map((r) => r.glyph)).size).toBe(row.length)
      row.forEach((rune, i) => {
        expect(rune.index).toBe(i)
        expect(rune.modern).toBe(false)
        expect(Object.isFrozen(rune)).toBe(true)
      })
      expect(Object.isFrozen(row)).toBe(true)
    }
    expect(FUTHARKS.elder).toBe(ELDER_FUTHARK)
  })

  test('Younger Futhark: Norwegian rune poem order, long-branch code points, ættir 6/5/5', () => {
    expect(ids(YOUNGER_FUTHARK)).toEqual([
      'fe',
      'ur',
      'thurs',
      'oss',
      'reid',
      'kaun',
      'hagall',
      'naudr',
      'iss',
      'ar',
      'sol',
      'tyr',
      'bjarkan',
      'madr',
      'logr',
      'yr',
    ])
    // UnicodeData: FEHU FEOH FE F, URUZ UR U, THURISAZ THURS THORN, LONG-BRANCH-OSS O,
    // RAIDO RAD REID R, KAUN K, LONG-BRANCH-HAGALL H, NAUDIZ NYD NAUD N, ISAZ IS ISS I,
    // LONG-BRANCH-AR AE, SIGEL LONG-BRANCH-SOL S, TIWAZ TIR TYR T, BERKANAN BEORC BJARKAN B,
    // LONG-BRANCH-MADR M, LAUKAZ LAGU LOGR L, LONG-BRANCH-YR.
    expect(codePoints(YOUNGER_FUTHARK)).toEqual([
      '16A0',
      '16A2',
      '16A6',
      '16AC',
      '16B1',
      '16B4',
      '16BC',
      '16BE',
      '16C1',
      '16C5',
      '16CB',
      '16CF',
      '16D2',
      '16D8',
      '16DA',
      '16E6',
    ])
    expect(YOUNGER_FUTHARK.map((r) => r.aett)).toEqual([
      1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3,
    ])
    expect(YOUNGER_FUTHARK[6]?.aettName).toBe('Heimdall')
    expect(YOUNGER_FUTHARK.every((r) => !r.invertible)).toBe(true)
  })

  test('futhorc 29: Old English rune poem stanza order (ēþel before dæg; āc æsc ȳr īor ēar)', () => {
    expect(ids(FUTHORC_29)).toEqual([
      'feoh',
      'ur',
      'thorn',
      'os',
      'rad',
      'cen',
      'gyfu',
      'wynn',
      'haegl',
      'nyd',
      'is',
      'ger',
      'eoh',
      'peorth',
      'eolhx',
      'sigel',
      'tir',
      'beorc',
      'eh',
      'mann',
      'lagu',
      'ing',
      'ethel',
      'daeg',
      'ac',
      'aesc',
      'yr',
      'ior',
      'ear',
    ])
    // UnicodeData names: OS, CEN, HAEGL, GER, IWAZ EOH, ALGIZ EOLHX, SIGEL…, ING,
    // OTHALAN ETHEL, DAGAZ DAEG, AC, AESC, YR, IOR, EAR.
    expect(codePoints(FUTHORC_29)).toEqual([
      '16A0',
      '16A2',
      '16A6',
      '16A9',
      '16B1',
      '16B3',
      '16B7',
      '16B9',
      '16BB',
      '16BE',
      '16C1',
      '16C4',
      '16C7',
      '16C8',
      '16C9',
      '16CB',
      '16CF',
      '16D2',
      '16D6',
      '16D7',
      '16DA',
      '16DD',
      '16DF',
      '16DE',
      '16AA',
      '16AB',
      '16A3',
      '16E1',
      '16E0',
    ])
    expect(FUTHORC_29.every((r) => r.aett === null && r.aettName === null)).toBe(true)
  })

  test('futhorc 28 = 29 without īor; futhorc 33 = 29 + cweorð, calc, stān, gār (Hickes)', () => {
    expect(ids(FUTHORC_28)).toEqual(ids(FUTHORC_29).filter((id) => id !== 'ior'))
    expect(ids(FUTHORC_33).slice(0, 29)).toEqual(ids(FUTHORC_29))
    expect(ids(FUTHORC_33).slice(29)).toEqual(['cweorth', 'calc', 'stan', 'gar'])
    // CWEORTH, CALC, STAN, GAR
    expect(codePoints(FUTHORC_33).slice(29)).toEqual(['16E2', '16E3', '16E5', '16B8'])
  })

  test('runeSet with blank appends one modern, glyphless, non-invertible rune (cached)', () => {
    for (const [name, row] of Object.entries(FUTHARKS)) {
      const set = runeSet(name as keyof typeof FUTHARKS, true)
      expect(set.length).toBe(row.length + 1)
      expect(set.slice(0, row.length)).toEqual([...row])
      expect(set[row.length]).toMatchObject({
        id: 'blank',
        glyph: '',
        aett: null,
        invertible: false,
        modern: true,
        index: row.length,
      })
      expect(runeSet(name as keyof typeof FUTHARKS, true)).toBe(set)
      expect(runeSet(name as keyof typeof FUTHARKS, false)).toBe(row)
      expect(Object.isFrozen(set)).toBe(true)
    }
  })

  test('the Norns layout: Urðr, Verðandi, Skuld', () => {
    expect(RUNE_LAYOUTS.norns.positions.map((p) => p.name)).toEqual(['Urðr', 'Verðandi', 'Skuld'])
    expect(Object.isFrozen(RUNE_LAYOUTS.norns.positions[2])).toBe(true)
  })
})
