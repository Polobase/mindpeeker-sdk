import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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
  test('holds all 43 ciphers with unique ids, deeply frozen', () => {
    expect(CIPHERS.length).toBe(43)
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
    ]
    const ids = new Set(CIPHERS.map((c) => c.id))
    for (const id of frontend) expect(ids.has(id as (typeof CIPHERS)[number]['id'])).toBe(true)
  })

  test('CIPHERS_BY_SCRIPT partitions the registry by script', () => {
    expect(CIPHERS_BY_SCRIPT.hebrew.length).toBe(11)
    expect(CIPHERS_BY_SCRIPT.greek).toEqual(['gr-isopsephy', 'gr-ordinal'])
    expect(CIPHERS_BY_SCRIPT.arabic).toEqual(['ar-abjad'])
    expect(CIPHERS_BY_SCRIPT.latin.length).toBe(23)
    expect(CIPHERS_BY_SCRIPT.cyrillic).toEqual(['cu-cyrillic'])
    expect(CIPHERS_BY_SCRIPT.armenian).toEqual(['hy-numerals'])
    expect(CIPHERS_BY_SCRIPT.georgian).toEqual(['ka-numerals'])
    expect(CIPHERS_BY_SCRIPT.coptic).toEqual(['cop-numerals'])
    expect(CIPHERS_BY_SCRIPT.syriac).toEqual(['syr-numerals'])
    expect(CIPHERS_BY_SCRIPT.gothic).toEqual(['got-numerals'])
    const total = Object.values(CIPHERS_BY_SCRIPT).reduce((sum, ids) => sum + ids.length, 0)
    expect(total).toBe(CIPHERS.length)
    for (const [script, ids] of Object.entries(CIPHERS_BY_SCRIPT)) {
      for (const id of ids)
        expect(getCipher(id).script).toBe(script as (typeof CIPHERS)[number]['script'])
    }
  })

  test('the frontend-parity ids keep their registry positions', () => {
    expect(CIPHERS.slice(0, 11).map((c) => c.script)).toEqual(Array(11).fill('hebrew'))
    expect(CIPHERS[11]?.id).toBe('gr-isopsephy')
    expect(CIPHERS_BY_SCRIPT.latin.slice(0, 2)).toEqual(['en-ordinal', 'en-reduction'])
  })

  test('extended methods are flagged and excluded from the default profile', () => {
    const extended = CIPHERS.filter((c) => c.extended).map((c) => c.id)
    expect(extended.sort()).toEqual([
      'en-aq',
      'en-naeq',
      'en-tq',
      'gr-ordinal',
      'he-katan-mispari',
      'he-kidmi',
      'he-milui',
      'he-neelam',
      'he-perati',
      'la-elizabethan-kaye',
      'la-elizabethan-simple',
      'la-roman',
    ])
    // the sole cipher of a script is never extended
    for (const ids of Object.values(CIPHERS_BY_SCRIPT)) {
      if (ids.length === 1) expect(getCipher(ids[0] as (typeof ids)[number]).extended).toBe(false)
    }
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

describe('README cipher catalog', () => {
  const readme = readFileSync(join(import.meta.dir, '..', 'README.md'), 'utf8')

  test('every stated cipher count equals CIPHERS.length', () => {
    const counts = [...readme.matchAll(/\*\*(\d+) ciphers\*\*/g)].map((m) => Number(m[1]))
    expect(counts.length).toBeGreaterThan(0)
    for (const count of counts) expect(count).toBe(CIPHERS.length)
  })

  test('every cipher id is documented', () => {
    for (const c of CIPHERS) expect(readme.includes(`\`${c.id}\``), c.id).toBe(true)
  })
})
