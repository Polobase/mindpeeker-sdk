import { describe, expect, test } from 'bun:test'
import { GematriaError } from '../src/errors.js'
import {
  ALIASES,
  CIPHERS,
  CIPHERS_BY_SCRIPT,
  cipherFromId,
  getCipher,
  resolveCipherId,
} from '../src/registry.js'

describe('cipher registry', () => {
  test('holds all 23 ciphers with unique ids, deeply frozen', () => {
    expect(CIPHERS.length).toBe(23)
    const ids = CIPHERS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(Object.isFrozen(CIPHERS)).toBe(true)
    for (const c of CIPHERS) expect(Object.isFrozen(c)).toBe(true)
  })

  test('every frontend cipher id is present', () => {
    const frontend = [
      'he-hechrachi',
      'he-gadol',
      'he-siduri',
      'he-katan',
      'he-atbash',
      'he-albam',
      'gr-isopsephy',
      'en-ordinal',
      'en-reduction',
      'en-reverse',
    ]
    const ids = new Set(CIPHERS.map((c) => c.id))
    for (const id of frontend) expect(ids.has(id as (typeof CIPHERS)[number]['id'])).toBe(true)
  })

  test('CIPHERS_BY_SCRIPT partitions the registry by script', () => {
    expect(CIPHERS_BY_SCRIPT.hebrew.length).toBe(11)
    expect(CIPHERS_BY_SCRIPT.greek).toEqual(['gr-isopsephy'])
    expect(CIPHERS_BY_SCRIPT.arabic).toEqual(['ar-abjad'])
    expect(CIPHERS_BY_SCRIPT.latin.length).toBe(10)
    const total =
      CIPHERS_BY_SCRIPT.hebrew.length +
      CIPHERS_BY_SCRIPT.greek.length +
      CIPHERS_BY_SCRIPT.arabic.length +
      CIPHERS_BY_SCRIPT.latin.length
    expect(total).toBe(CIPHERS.length)
  })

  test('extended methods are flagged and excluded from the default profile', () => {
    const extended = CIPHERS.filter((c) => c.extended).map((c) => c.id)
    expect(extended.sort()).toEqual([
      'en-naeq',
      'he-katan-mispari',
      'he-kidmi',
      'he-milui',
      'he-neelam',
      'he-perati',
    ])
    // ar-abjad is the sole cipher of its script, so it is NOT extended
    expect(CIPHERS.find((c) => c.id === 'ar-abjad')?.extended).toBeFalsy()
  })

  test('getCipher resolves a known id and throws unknown_cipher otherwise', () => {
    expect(getCipher('en-ordinal').label).toBe('Ordinal')
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => getCipher('bogus' as any)).toThrow(GematriaError)
    try {
      // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
      getCipher('bogus' as any)
    } catch (e) {
      expect((e as GematriaError).code).toBe('unknown_cipher')
    }
  })

  test('cipherFromId returns undefined for an unknown id', () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(cipherFromId('bogus' as any)).toBeUndefined()
    expect(cipherFromId('gr-isopsephy')?.script).toBe('greek')
  })
})

describe('cipher aliases', () => {
  test('resolveCipherId maps every alias to its canonical id', () => {
    expect(resolveCipherId('jewish')).toBe('la-jewish')
    expect(resolveCipherId('hebrew')).toBe('he-hechrachi')
    expect(resolveCipherId('latin')).toBe('la-agrippa')
    expect(resolveCipherId('english')).toBe('en-english')
    expect(resolveCipherId('simple')).toBe('en-ordinal')
    expect(resolveCipherId('ordinal')).toBe('en-ordinal')
    expect(resolveCipherId('reverse')).toBe('en-reverse')
    expect(resolveCipherId('sumerian')).toBe('en-sumerian')
    expect(resolveCipherId('isopsephy')).toBe('gr-isopsephy')
  })

  test('every ALIASES value is a real, resolvable cipher id', () => {
    for (const id of Object.values(ALIASES)) expect(cipherFromId(id)).toBeDefined()
  })

  test('a canonical id passes through unchanged', () => {
    expect(resolveCipherId('he-hechrachi')).toBe('he-hechrachi')
  })

  test('getCipher and cipherFromId accept a friendly alias', () => {
    expect(getCipher('jewish').id).toBe('la-jewish')
    expect(cipherFromId('simple')?.id).toBe('en-ordinal')
  })

  test('an unknown alias/id still throws unknown_cipher', () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    expect(() => getCipher('not-a-real-alias' as any)).toThrow(GematriaError)
    try {
      // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
      getCipher('not-a-real-alias' as any)
    } catch (e) {
      expect((e as GematriaError).code).toBe('unknown_cipher')
    }
  })
})
