import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { hwRng } from '../../src/node/hwrng.js'

describe('hwRng', () => {
  test('is named hwrng with kind trng', () => {
    const p = hwRng()
    expect(p.name).toBe('hwrng')
    expect(p.kind).toBe('trng')
    expect(p.privacy).toBe('private')
  })

  test('a missing device maps to a helpful network error', async () => {
    const err = (await hwRng({ path: '/nonexistent/hwrng-xyz' })
      .getBytes(8)
      .catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('network')
    expect(err.message).toContain('does not exist')
  })
})
