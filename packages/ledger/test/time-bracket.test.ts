import { describe, expect, test } from 'bun:test'
import { sealBeacon, sealToBytes, verifySealBytes } from '@mindpeeker/vdf'
import { fromHex, toHex } from '../src/hash.js'
import {
  timeBracketHash,
  timeBracketSealInput,
  validateTimeBracket,
  verifyTimeBracket,
} from '../src/time-bracket.js'
import type { TimeBracket } from '../src/types.js'
import { fixture, flip } from './helpers/fixtures.js'

interface Kat {
  registration: { hash: string }
  bracket: { value: TimeBracket; sealInput: string; hash: string }
}
const kat = fixture<Kat>('records-kat.json')
const bracket = kat.bracket.value
const invalidBracket = expect.objectContaining({ code: 'invalid_bracket' })

/** A real Pietrzak seal over the bracket's seal input (small T: this is a format test). */
async function sealed(b: TimeBracket, T = 64): Promise<TimeBracket> {
  const input = timeBracketSealInput(b)
  const bytes = sealToBytes(await sealBeacon(input, T), input)
  return { ...b, seal: { kind: 'vdf-pietrzak', bytesHex: toHex(bytes) } }
}

describe('time-bracket records (Python known answers)', () => {
  test('seal input and bracket hash match the independent computation', async () => {
    expect(new TextDecoder().decode(timeBracketSealInput(bracket))).toBe(kat.bracket.sealInput)
    expect(await timeBracketHash(bracket)).toBe(kat.bracket.hash)
    expect(bracket.registrationHash).toBe(kat.registration.hash)
  })

  test('the seal input ignores the seal and the notAfter witness', async () => {
    const withSeal = await sealed(bracket)
    const { notAfter: _omit, ...withoutWitness } = bracket
    expect(timeBracketSealInput(withSeal)).toEqual(timeBracketSealInput(withoutWitness))
    expect(await timeBracketHash(withSeal)).not.toBe(kat.bracket.hash)
  })
})

describe('validateTimeBracket', () => {
  const b = bracket.notBefore.beacon
  const cases: [string, unknown, string][] = [
    ['non-object', null, '$'],
    ['unknown field', { ...bracket, extra: 1 }, '$.extra'],
    ['registration hash', { ...bracket, registrationHash: 'xyz' }, '$.registrationHash'],
    ['missing beacon', { ...bracket, notBefore: {} }, '$.notBefore.beacon'],
    ['negative round', { ...bracket, notBefore: { beacon: { ...b, round: -1 } } }, 'round'],
    ['fractional round', { ...bracket, notBefore: { beacon: { ...b, round: 1.5 } } }, 'round'],
    ['empty chain', { ...bracket, notBefore: { beacon: { ...b, chain: '' } } }, 'chain'],
    [
      'local-time timestamp',
      { ...bracket, notBefore: { beacon: { ...b, timestamp: '2026-09-17T12:00:00+02:00' } } },
      'timestamp',
    ],
    [
      'impossible date',
      { ...bracket, notBefore: { beacon: { ...b, timestamp: '2026-02-30T12:00:00Z' } } },
      'calendar',
    ],
    ['odd hex value', { ...bracket, notBefore: { beacon: { ...b, valueHex: 'abc' } } }, 'valueHex'],
    ['upper-case hex', { ...bracket, notBefore: { beacon: { ...b, valueHex: 'AB' } } }, 'valueHex'],
    ['seal kind', { ...bracket, seal: { kind: 'vdf-wesolowski', bytesHex: '00' } }, '$.seal.kind'],
    ['empty seal', { ...bracket, seal: { kind: 'vdf-pietrzak', bytesHex: '' } }, 'bytesHex'],
    ['notAfter kind', { ...bracket, notAfter: { kind: 'email', ref: 'x' } }, '$.notAfter.kind'],
    ['notAfter ref', { ...bracket, notAfter: { kind: 'ots', ref: ' ' } }, '$.notAfter.ref'],
  ]
  test.each(cases)('rejects %s', (_name, value, where) => {
    expect(() => validateTimeBracket(value)).toThrow(invalidBracket)
    expect(() => validateTimeBracket(value)).toThrow(where)
  })

  test('accepts millisecond timestamps and returns a frozen copy', () => {
    const valid = validateTimeBracket({
      ...bracket,
      notBefore: { beacon: { ...b, timestamp: '2026-09-17T12:00:00.250Z' } },
    })
    expect(Object.isFrozen(valid.notBefore.beacon)).toBe(true)
  })
})

describe('verifyTimeBracket', () => {
  test('structure only: ok, with unverified witness and absent seal', async () => {
    expect(await verifyTimeBracket(bracket)).toEqual({
      ok: true,
      structure: 'valid',
      registration: 'unchecked',
      beacon: 'unchecked',
      seal: 'absent',
      notAfter: 'unverified',
      notBeforeTime: '2026-09-17T12:00:00Z',
      issues: [],
    })
  })

  test('registration binding and beacon checks', async () => {
    const good = await verifyTimeBracket(bracket, {
      registrationHash: kat.registration.hash,
      minRound: 23_456_789,
      beacon: { round: 23_456_789, valueHex: 'ab'.repeat(32) },
    })
    expect(good).toMatchObject({ ok: true, registration: 'match', beacon: 'ok' })
    const bad = await verifyTimeBracket(bracket, {
      registrationHash: 'ff'.repeat(32),
      minRound: 23_456_790,
      beacon: { valueHex: 'cd'.repeat(32) },
    })
    expect(bad).toMatchObject({ ok: false, registration: 'mismatch', beacon: 'mismatch' })
    expect(bad.issues.length).toBe(3)
  })

  test('a real @mindpeeker/vdf seal verifies through the verifySealBytes hook', async () => {
    const withSeal = await sealed(bracket)
    const result = await verifyTimeBracket(withSeal, {
      verifySeal: verifySealBytes,
      requireSeal: true,
    })
    expect(result).toMatchObject({ ok: true, seal: 'verified' })
    // without a hook the same seal is only present, not verified
    expect((await verifyTimeBracket(withSeal)).seal).toBe('unverified')
  })

  test('a seal for different content, or corrupted bytes, fails', async () => {
    const withSeal = await sealed(bracket)
    const moved = {
      ...withSeal,
      notBefore: { beacon: { ...bracket.notBefore.beacon, round: 23_456_790 } },
    }
    const other = await verifyTimeBracket(moved, { verifySeal: verifySealBytes })
    expect(other).toMatchObject({ ok: false, seal: 'failed' })
    const bytes = fromHex(withSeal.seal?.bytesHex as string)
    flip(bytes, bytes.length - 1)
    const corrupted = {
      ...withSeal,
      seal: { kind: 'vdf-pietrzak' as const, bytesHex: toHex(bytes) },
    }
    expect((await verifyTimeBracket(corrupted, { verifySeal: verifySealBytes })).seal).toBe(
      'failed',
    )
  })

  test('a throwing verifier is a failed check, not a throw', async () => {
    const withSeal = { ...bracket, seal: { kind: 'vdf-pietrzak' as const, bytesHex: '0102' } }
    const result = await verifyTimeBracket(withSeal, { verifySeal: verifySealBytes })
    expect(result.seal).toBe('failed')
    expect(result.issues[0]).toContain('seal verifier threw')
  })

  test('require flags and the notAfter hook', async () => {
    const { notAfter: _omit, ...bare } = bracket
    const required = await verifyTimeBracket(bare, { requireSeal: true, requireNotAfter: true })
    expect(required).toMatchObject({ ok: false, seal: 'absent', notAfter: 'absent' })
    expect(required.issues.length).toBe(2)
    const seen: string[] = []
    const witnessed = await verifyTimeBracket(bracket, {
      verifyNotAfter: (anchor) => {
        seen.push(anchor.ref)
        return anchor.kind === 'rekor'
      },
    })
    expect(witnessed).toMatchObject({ ok: true, notAfter: 'verified' })
    expect(seen).toEqual(['108e9186e8c5677a'])
    const rejected = await verifyTimeBracket(bracket, { verifyNotAfter: async () => false })
    expect(rejected).toMatchObject({ ok: false, notAfter: 'failed' })
  })

  test('malformed records are reported; malformed options throw', async () => {
    const result = await verifyTimeBracket({ ...bracket, registrationHash: 'x' })
    expect(result).toMatchObject({ ok: false, structure: 'invalid' })
    const invalid = { code: 'invalid_input' }
    await expect(verifyTimeBracket(bracket, { minRound: -1 })).rejects.toMatchObject(invalid)
    await expect(verifyTimeBracket(bracket, { registrationHash: 'x' })).rejects.toMatchObject(
      invalid,
    )
    await expect(verifyTimeBracket(bracket, { verifySeal: 'yes' as never })).rejects.toMatchObject(
      invalid,
    )
  })
})

test('verifyTimeBracket rejects expected beacon fields that do not exist', async () => {
  await expect(
    verifyTimeBracket(kat.bracket.value, { beacon: { value: 'ab' } as never }),
  ).rejects.toMatchObject({ code: 'invalid_input' })
})
