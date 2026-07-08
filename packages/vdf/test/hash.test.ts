import { describe, expect, test } from 'bun:test'
import { DOMAIN_TAG, fiatShamirChallenge, hashToGroup } from '../src/hash.js'
import { RSA2048 } from '../src/moduli.js'
import { expectVdfError } from './helpers/expect.js'
import { fromHex, loadFixture } from './helpers/fixture.js'
import { isQuadraticResidue, TEST_MODULUS } from './helpers/test-modulus.js'

const fixture = loadFixture()

describe('transcript pinning', () => {
  test('the domain tag is frozen into the protocol', () => {
    expect(DOMAIN_TAG).toBe('mindpeeker-vdf-v1')
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

  test('outputs are quadratic residues (checked via the known factorization)', async () => {
    for (const { inputHex } of fixture.hashToGroup) {
      expect(isQuadraticResidue(await hashToGroup(fromHex(inputHex), TEST_MODULUS))).toBe(true)
    }
    for (const extra of ['a', 'b', 'longer input string', '42']) {
      const bytes = new TextEncoder().encode(extra)
      expect(isQuadraticResidue(await hashToGroup(bytes, TEST_MODULUS))).toBe(true)
    }
  })

  test('is deterministic and lands in [0, n) on RSA-2048 too', async () => {
    const input = new TextEncoder().encode('pulse-1')
    const a = await hashToGroup(input, RSA2048)
    const b = await hashToGroup(input, RSA2048)
    expect(a).toBe(b)
    expect(a >= 0n && a < RSA2048.n).toBe(true)
  })

  test('distinct inputs map to distinct elements', async () => {
    const seen = new Set<string>()
    for (const { x } of fixture.hashToGroup) {
      expect(seen.has(x)).toBe(false)
      seen.add(x)
    }
  })

  test('accepts ArrayLike<number> input and rejects malformed bytes', async () => {
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

  test('is 128 bits and sensitive to every transcript field', async () => {
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
  })
})
