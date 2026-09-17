import { describe, expect, test } from 'bun:test'
import {
  CHALLENGE_PRIME_BITS,
  DOMAIN_TAG,
  fiatShamirChallenge,
  hashToGroup,
  hashToPrime,
  modulusFingerprint,
} from '../src/hash.js'
import { bitLength } from '../src/internal/bigint.js'
import { RSA2048 } from '../src/moduli.js'
import { expectVdfError, expectVdfThrow } from './helpers/expect.js'
import { fromHex, loadFixture, toHex } from './helpers/fixture.js'
import { isQuadraticResidue, TEST_MODULUS } from './helpers/test-modulus.js'

const fixture = loadFixture()
const n = TEST_MODULUS.n
const ODD_MODULUS = { n: BigInt(fixture.oddWidth.n) }

describe('transcript pinning', () => {
  test('the domain tag is frozen into the protocol (v2 since 0.2.0)', () => {
    expect(DOMAIN_TAG).toBe('mindpeeker-vdf-v2')
  })

  test('the test modulus matches the fixture generator', () => {
    expect(TEST_MODULUS.n.toString()).toBe(fixture.modulus.n)
  })
})

describe('hashToGroup', () => {
  test('matches the independent Python encoding for every fixture input', async () => {
    for (const { inputHex, x } of fixture.hashToGroup) {
      expect((await hashToGroup(fromHex(inputHex), TEST_MODULUS)).toString()).toBe(x)
    }
  })

  test('matches Python on RSA-2048 (8 blocks) and a 522-bit modulus (3 blocks, ragged width)', async () => {
    const rsa = fixture.rsa2048.hashToGroup
    expect((await hashToGroup(fromHex(rsa.inputHex), RSA2048)).toString()).toBe(rsa.x)
    expect(bitLength(ODD_MODULUS.n)).toBe(fixture.oddWidth.bits)
    const odd = fixture.oddWidth.hashToGroup
    expect((await hashToGroup(fromHex(odd.inputHex), ODD_MODULUS)).toString()).toBe(odd.x)
  })

  test('outputs are canonical signed quadratic residues', async () => {
    const inputs = fixture.hashToGroup.map(({ inputHex }) => fromHex(inputHex))
    for (const extra of ['a', 'b', 'longer input string', '42']) {
      inputs.push(new TextEncoder().encode(extra))
    }
    for (const bytes of inputs) {
      const x = await hashToGroup(bytes, TEST_MODULUS)
      expect(x >= 1n && x <= (n - 1n) / 2n).toBe(true)
      // x or −x is a square: |h²| = ±h².
      expect(isQuadraticResidue(x) || isQuadraticResidue(n - x)).toBe(true)
    }
  })

  test('binds the modulus: the same input maps differently under a different modulus', async () => {
    const input = new TextEncoder().encode('pulse-1')
    const a = await hashToGroup(input, TEST_MODULUS)
    const b = await hashToGroup(input, { n: n + 2n })
    expect(a).not.toBe(b)
  })

  test('snapshots its input: ArrayLike and Uint8Array agree; malformed bytes throw', async () => {
    const viaArray = await hashToGroup([112, 117, 108, 115, 101, 45, 49], TEST_MODULUS)
    const viaBytes = await hashToGroup(fromHex('70756c73652d31'), TEST_MODULUS)
    expect(viaArray).toBe(viaBytes)
    await expectVdfError(hashToGroup([256], TEST_MODULUS), 'invalid_input')
    await expectVdfError(hashToGroup([-1], TEST_MODULUS), 'invalid_input')
    await expectVdfError(
      hashToGroup('nope' as unknown as Uint8Array, TEST_MODULUS),
      'invalid_input',
    )
  })

  test('rejects an invalid modulus', async () => {
    const input = new Uint8Array([1])
    await expectVdfError(hashToGroup(input, { n: 15n }), 'invalid_modulus') // too small
    await expectVdfError(hashToGroup(input, { n: 2n ** 128n }), 'invalid_modulus') // even
    await expectVdfError(hashToGroup(input, {} as unknown as { n: bigint }), 'invalid_modulus')
  })
})

describe('fiatShamirChallenge', () => {
  test('matches the independent Python encoding', async () => {
    for (const { x, y, mu, T, r } of fixture.challenges) {
      const got = await fiatShamirChallenge(BigInt(x), BigInt(y), BigInt(mu), T, TEST_MODULUS)
      expect(got.toString()).toBe(r)
    }
  })

  test('is 128 bits and sensitive to every transcript field, including the modulus', async () => {
    const [c] = fixture.challenges
    if (!c) throw new Error('fixture has no challenge cases')
    const x = BigInt(c.x)
    const y = BigInt(c.y)
    const mu = BigInt(c.mu)
    const base = await fiatShamirChallenge(x, y, mu, c.T, TEST_MODULUS)
    expect(base < 2n ** 128n).toBe(true)
    expect(await fiatShamirChallenge(x + 1n, y, mu, c.T, TEST_MODULUS)).not.toBe(base)
    expect(await fiatShamirChallenge(x, y + 1n, mu, c.T, TEST_MODULUS)).not.toBe(base)
    expect(await fiatShamirChallenge(x, y, mu + 1n, c.T, TEST_MODULUS)).not.toBe(base)
    expect(await fiatShamirChallenge(x, y, mu, c.T + 1, TEST_MODULUS)).not.toBe(base)
    // Same byte width, different modulus → different challenge.
    expect(await fiatShamirChallenge(x, y, mu, c.T, { n: n + 2n })).not.toBe(base)
  })
})

describe('hashToPrime', () => {
  test('matches the Python mirror (whose primes were confirmed by 40 random-base rounds)', async () => {
    const cases = [
      [fixture.wesolowski, TEST_MODULUS],
      [[fixture.rsa2048.wesolowski], RSA2048],
      [[fixture.oddWidth.wesolowski], ODD_MODULUS],
    ] as const
    for (const [list, modulus] of cases) {
      for (const { inputHex, T, y, ell } of list) {
        const x = await hashToGroup(fromHex(inputHex), modulus)
        const got = await hashToPrime(x, BigInt(y), T, modulus)
        expect(got.toString()).toBe(ell)
        expect(bitLength(got)).toBe(CHALLENGE_PRIME_BITS)
      }
    }
  })

  test('changes with y and T', async () => {
    const [c] = fixture.wesolowski
    if (!c) throw new Error('fixture has no Wesolowski cases')
    const x = await hashToGroup(fromHex(c.inputHex), TEST_MODULUS)
    const ell = await hashToPrime(x, BigInt(c.y), c.T, TEST_MODULUS)
    expect(await hashToPrime(x, BigInt(c.y) + 1n, c.T, TEST_MODULUS)).not.toBe(ell)
    expect(await hashToPrime(x, BigInt(c.y), c.T + 1, TEST_MODULUS)).not.toBe(ell)
  })
})

describe('modulusFingerprint', () => {
  test('matches Python for the test modulus and RSA-2048, and is 8 fresh bytes', () => {
    expect(toHex(modulusFingerprint(TEST_MODULUS))).toBe(fixture.fingerprint)
    expect(toHex(modulusFingerprint(RSA2048))).toBe(fixture.rsa2048.fingerprint)
    const a = modulusFingerprint(TEST_MODULUS)
    a[0] = (a[0] as number) ^ 0xff
    expect(toHex(modulusFingerprint(TEST_MODULUS))).toBe(fixture.fingerprint)
  })

  test('rejects an invalid modulus', () => {
    expectVdfThrow(() => modulusFingerprint({ n: 4n }), 'invalid_modulus')
  })
})
