import { describe, expect, test } from 'bun:test'
import { verifyChain as psiVerifyChain, recordSession } from '@mindpeeker/psi'
import {
  REGISTRATION_SCHEMA,
  registrationCanonical,
  registrationHash,
  validateRegistration,
} from '../src/registration.js'
import type { Registration } from '../src/types.js'
import { collect, fixture } from './helpers/fixtures.js'

interface Kat {
  registration: { value: Registration; canonical: string; hash: string }
}
const kat = fixture<Kat>('records-kat.json')
const base = kat.registration.value
const invalidRegistration = expect.objectContaining({ code: 'invalid_registration' })

describe('registrationHash (Python known answer)', () => {
  test('canonical envelope and hash match the independent computation', async () => {
    expect(registrationCanonical(base)).toBe(kat.registration.canonical)
    expect(await registrationHash(base)).toBe(kat.registration.hash)
    expect(kat.registration.canonical).toContain(`"schema":"${REGISTRATION_SCHEMA}"`)
  })

  test('member order in the input does not matter; undefined optionals are dropped', async () => {
    const shuffled = Object.fromEntries(Object.entries(base).reverse()) as unknown as Registration
    expect(await registrationHash(shuffled)).toBe(kat.registration.hash)
    expect(await registrationHash({ ...base, blinding: undefined, notes: undefined })).toBe(
      kat.registration.hash,
    )
  })

  test('any change to the content changes the hash', async () => {
    expect(await registrationHash({ ...base, alpha: 0.01 })).not.toBe(kat.registration.hash)
    expect(await registrationHash({ ...base, exclusions: [] })).not.toBe(kat.registration.hash)
  })
})

describe('validateRegistration', () => {
  test('returns a deeply frozen normalized copy', () => {
    const valid = validateRegistration(base)
    expect(valid).toEqual(base)
    expect(Object.isFrozen(valid)).toBe(true)
    expect(Object.isFrozen(valid.hypotheses[0])).toBe(true)
    expect(Object.isFrozen(valid.sample)).toBe(true)
  })

  test('accepts a sequential design with a plan hash and a revision link', () => {
    const sequential = validateRegistration({
      ...base,
      sample: {
        kind: 'sequential',
        rule: 'stop when BF10 >= 10 or BF01 >= 10, checked every 100 trials',
        minSize: 100,
        maxSize: 10_000,
        unit: 'trials',
        planHash: 'ab'.repeat(32),
      },
      supersedes: 'cd'.repeat(32),
      blinding: 'labels scrambled with a sealed key',
    })
    expect(sequential.sample.kind).toBe('sequential')
  })

  const h1 = base.hypotheses[0] as Registration['hypotheses'][0]
  const cases: [string, unknown, string][] = [
    ['non-object', 42, '$'],
    ['unknown field', { ...base, exclusion: [] }, '$.exclusion'],
    ['empty title', { ...base, title: '  ' }, '$.title'],
    ['no hypotheses', { ...base, hypotheses: [] }, '$.hypotheses'],
    ['duplicate hypothesis ids', { ...base, hypotheses: [h1, { ...h1 }] }, 'duplicate id'],
    [
      'no confirmatory hypothesis',
      {
        ...base,
        hypotheses: [{ id: 'E1', statement: 's', kind: 'exploratory' }],
        primary: 'E1',
      },
      'confirmatory',
    ],
    [
      'confirmatory without statistic',
      { ...base, hypotheses: [{ ...h1, statistic: undefined }] },
      '$.hypotheses[0].statistic',
    ],
    [
      'confirmatory with bad direction',
      { ...base, hypotheses: [{ ...h1, direction: 'up' }] },
      '$.hypotheses[0].direction',
    ],
    ['primary not confirmatory', { ...base, primary: 'E1' }, '$.primary'],
    ['alpha out of range', { ...base, alpha: 1 }, '$.alpha'],
    ['alpha NaN', { ...base, alpha: Number.NaN }, '$.alpha'],
    [
      'two confirmatory without correction',
      { ...base, hypotheses: [h1, { ...h1, id: 'H2' }] },
      '$.correction',
    ],
    ['unknown correction', { ...base, correction: 'sidak' }, '$.correction'],
    ['sample size zero', { ...base, sample: { kind: 'fixed', size: 0, unit: 'trials' } }, 'size'],
    ['sample kind', { ...base, sample: { kind: 'open-ended' } }, '$.sample.kind'],
    [
      'minSize above maxSize',
      { ...base, sample: { kind: 'sequential', rule: 'r', minSize: 9, maxSize: 3, unit: 'u' } },
      'minSize',
    ],
    ['plan hash', { ...base, analysisPlanHash: 'AB'.repeat(32) }, '$.analysisPlanHash'],
    ['exclusions not array', { ...base, exclusions: 'none' }, '$.exclusions'],
    ['no data sources', { ...base, dataSources: [] }, '$.dataSources'],
    [
      'duplicate data sources',
      { ...base, dataSources: [{ name: 'a' }, { name: 'a' }] },
      'duplicate name',
    ],
    ['bad role', { ...base, dataSources: [{ name: 'a', role: 'sham' }] }, 'role'],
  ]
  test.each(cases)('rejects %s', (_name, value, where) => {
    expect(() => validateRegistration(value)).toThrow(invalidRegistration)
    expect(() => validateRegistration(value)).toThrow(where)
  })

  test('two confirmatory hypotheses are fine with a correction', () => {
    const valid = validateRegistration({
      ...base,
      hypotheses: [h1, { ...h1, id: 'H2' }],
      correction: 'holm',
    })
    expect(valid.correction).toBe('holm')
  })
})

describe('interoperation with @mindpeeker/psi (structural, test-only import)', () => {
  test('a registration hash binds a psi schema-v2 recording as its genesis', async () => {
    const hash = await registrationHash(base)
    const source = {
      name: 'truerng-3',
      async *stream() {
        for (let i = 0; i < 4; i++) yield new Uint8Array([i * 17, 255 - i])
      },
    }
    let t = 0
    const lines = await collect(
      recordSession([source], { bitsPerTrial: 16, now: () => ++t, chain: { registration: hash } }),
    )
    expect(lines[0]).toContain(`"genesis":"${hash}"`)
    expect((await psiVerifyChain(lines, { registration: hash })).ok).toBe(true)
  })
})
