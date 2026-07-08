import { describe, expect, test } from 'bun:test'
import { dialToBase44, parseRate } from '@mindpeeker/rate'
import type { RateEntryLike } from '../src/catalog.js'
import { catalogFromRateEntries, defineCatalog, rateFromSystems } from '../src/catalog.js'
import { ScanError } from '../src/errors.js'

describe('defineCatalog', () => {
  test('freezes the catalog and its items, defaulting id to name', () => {
    const cat = defineCatalog('c', 'Catalog', [{ name: 'Arnica' }, { name: 'Silica', id: 'si' }])
    expect(Object.isFrozen(cat)).toBe(true)
    expect(Object.isFrozen(cat.items)).toBe(true)
    expect(Object.isFrozen(cat.items[0])).toBe(true)
    expect(cat.items[0]?.id).toBe('Arnica')
    expect(cat.items[1]?.id).toBe('si')
  })

  test('rejects an empty catalog and a nameless item', () => {
    expect(() => defineCatalog('c', 'C', [])).toThrow(ScanError)
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed item
    expect(() => defineCatalog('c', 'C', [{ name: '' } as any])).toThrow(ScanError)
  })
})

describe('rateFromSystems', () => {
  test('combe.base10 bridges to base-44 via dialToBase44 (exact projection)', () => {
    const rate = rateFromSystems({ combe: { base10: '23344', base44: '05 09 12 14 16' } })
    expect(rate).toEqual(dialToBase44([2, 3, 3, 4, 4]).rate)
    expect(rate?.base).toBe(44)
    expect(rate?.digits).toEqual([9, 13, 13, 18, 18])
  })

  test('delawarr base-10 dial projects to base 44', () => {
    expect(rateFromSystems({ delawarr: '149' })?.digits).toEqual([4, 18, 40])
  })

  test('krt two-dial 0..100 reads integer dials as base-100 then to 44', () => {
    expect(rateFromSystems({ krt: { rate: '60.00-58.00' } })).toEqual(
      dialToBase44([60, 58], { fromBase: 100 }).rate,
    )
  })

  test('combe.base44 only falls back to parseRate at base 44', () => {
    expect(rateFromSystems({ combe: { base44: '05 09 12' } })).toEqual(
      parseRate('5-9-12', { base: 44 }),
    )
  })

  test('copenOrgan base-10 resolves when nothing better exists', () => {
    expect(rateFromSystems({ copenOrgan: '5225' })?.base).toBe(44)
  })

  test('tolerates missing / malformed systems', () => {
    expect(rateFromSystems(undefined)).toBeUndefined()
    expect(rateFromSystems({})).toBeUndefined()
    expect(rateFromSystems({ delawarr: 'not-digits' })).toBeUndefined()
    // base44 token out of range → skipped, not thrown
    expect(rateFromSystems({ combe: { base44: '50 90' } })).toBeUndefined()
  })
})

describe('catalogFromRateEntries', () => {
  const entries: RateEntryLike[] = [
    {
      term: 'Ma Huang',
      slug: 'ma-huang',
      systems: { combe: { base10: '1223', base44: '02 03 06' } },
      categories: [],
    },
    { term: 'Macaroni', slug: 'macaroni', systems: { delawarr: '149' }, categories: ['Willow'] },
    { term: 'Machupo', systems: { krt: { rate: '60.00-58.00' } }, categories: [] },
    { term: 'Mystery', systems: {}, categories: ['unknown'] },
  ]

  test('bridges every entry, keeping unresolvable ones without a rate', () => {
    const cat = catalogFromRateEntries(entries, { id: 'm', name: 'M shard' })
    expect(cat.id).toBe('m')
    expect(cat.items.length).toBe(4)
    expect(cat.items[0]?.rate).toEqual(dialToBase44([1, 2, 2, 3]).rate)
    expect(cat.items[1]?.category).toBe('Willow')
    expect(cat.items[2]?.rate?.base).toBe(44)
    expect(cat.items[3]?.rate).toBeUndefined()
    expect(cat.items[3]?.name).toBe('Mystery')
  })

  test('rejects an empty entry list', () => {
    expect(() => catalogFromRateEntries([])).toThrow(ScanError)
  })
})
