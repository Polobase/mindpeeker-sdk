import { afterAll, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EntropyError } from '../../src/errors.js'
import { hwRng } from '../../src/node/hwrng.js'

const dir = mkdtempSync(join(tmpdir(), 'entropy-hwrng-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** A character device that never runs dry, readable without privileges. */
const URANDOM = '/dev/urandom'
const hasUrandom = existsSync(URANDOM)

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

  test.skipIf(process.getuid?.() === 0)(
    'an unreadable device maps to network with a privilege hint',
    async () => {
      const locked = join(dir, 'locked')
      writeFileSync(locked, new Uint8Array(4096))
      chmodSync(locked, 0o000)
      const err = (await hwRng({ path: locked })
        .getBytes(8)
        .catch((e) => e)) as EntropyError
      expect(err.code).toBe('network')
      expect(err.message).toContain('root-only')
      expect((err.cause as NodeJS.ErrnoException).code).toBe('EACCES')
    },
  )

  test('a device that ends reports insufficient_entropy', async () => {
    const short = join(dir, 'short')
    writeFileSync(short, crypto.getRandomValues(new Uint8Array(512)))
    const err = (await hwRng({ path: short })
      .getBytes(8)
      .catch((e) => e)) as EntropyError
    expect(err.code).toBe('insufficient_entropy')
  })

  test.skipIf(!hasUrandom)(
    'reads, health-tests and conditions a live character device',
    async () => {
      const { bytes, sources } = await hwRng({ path: URANDOM }).getBytes(64)
      expect(bytes).toHaveLength(64)
      expect(sources[0]?.name).toBe('hwrng')
    },
  )

  test.skipIf(!hasUrandom)('an aborted stream rejects with aborted', async () => {
    const controller = new AbortController()
    const iterator = hwRng({ path: URANDOM, conditioning: 'raw' })
      .stream({ signal: controller.signal, chunkBytes: 256 })
      [Symbol.asyncIterator]()
    expect(((await iterator.next()).value as Uint8Array).length).toBe(256)
    controller.abort()
    const err = (await iterator.next().catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('aborted')
  })
})
