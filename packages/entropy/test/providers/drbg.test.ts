import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { HmacDrbg, MAX_BYTES_PER_GENERATE } from '../../src/internal/hmac-drbg.js'
import { drbgProvider } from '../../src/providers/drbg.js'
import { providerContract } from '../helpers/provider-contract.js'

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex')
const fromHex = (text: string) => Uint8Array.from(Buffer.from(text, 'hex'))

/** seed = bytes 0..47 — the vectors below were derived with Python's hmac/hashlib (SP 800-90A §10.1.2). */
const SEED = Uint8Array.from({ length: 48 }, (_, i) => i)

// NIST CAVP HMAC_DRBG.rsp, [SHA-256] [PredictionResistance = False]
// [EntropyInputLen = 256] [NonceLen = 128] [PersonalizationStringLen = 0]
// [AdditionalInputLen = 0] [ReturnedBitsLen = 1024], COUNT = 0: instantiate,
// generate 1024 bits (discarded), generate 1024 bits (ReturnedBits). An
// independent Python implementation reproduces the same ReturnedBits.
const CAVP_ENTROPY = 'ca851911349384bffe89de1cbdc46e6831e44d34a4fb935ee285dd14b71a7488'
const CAVP_NONCE = '659ba96c601dc69fc902940805ec0ca8'
const CAVP_RETURNED =
  'e528e9abf2dece54d47c7e75e5fe302149f817ea9fb4bee6f4199697d04d5b89' +
  'd54fbb978a15b5c443c9ec21036d2460b6f73ebad0dc2aba6e624abf07745bc1' +
  '07694bb7547bb0995f70de25d6b29e2d3011bb19d27676c07162c8b5ccde0668' +
  '961df86803482cb37ed6d5c0bb8d50cf1f50d476aa0458bdaba806f48be9dcb8'

providerContract('drbgProvider', () => drbgProvider({ seed: SEED }), {
  kind: 'csprng',
  privacy: 'private',
  // 65_537 spans two SP 800-90A generate calls
  lengths: [1, 32, 65_537],
})

describe('HmacDrbg (SP 800-90A §10.1.2, SHA-256)', () => {
  test('reproduces the NIST CAVP no-reseed vector (COUNT 0)', async () => {
    const drbg = new HmacDrbg(fromHex(CAVP_ENTROPY + CAVP_NONCE))
    await drbg.generate(128)
    expect(hex(await drbg.generate(128))).toBe(CAVP_RETURNED)
  })

  test('rejects generate requests outside [1, 2^16] bytes', async () => {
    const drbg = new HmacDrbg(SEED)
    for (const bad of [0, MAX_BYTES_PER_GENERATE + 1, 1.5]) {
      expect(((await drbg.generate(bad).catch((e) => e)) as EntropyError).code).toBe(
        'invalid_request',
      )
    }
  })
})

describe('drbgProvider', () => {
  test('the provider reproduces the CAVP vector through getBytes', async () => {
    const p = drbgProvider({ seed: fromHex(CAVP_ENTROPY + CAVP_NONCE) })
    await p.getBytes(128)
    expect(hex((await p.getBytes(128)).bytes)).toBe(CAVP_RETURNED)
  })

  test('matches independently derived outputs with a personalization string', async () => {
    const p = drbgProvider({ seed: SEED, personalization: 'mindpeeker' })
    expect(hex((await p.getBytes(32)).bytes)).toBe(
      'c3788d4cc7c603c4b396060af06a6f1329d6ac5a72e126b5b5b70a7f52311532',
    )
    expect(hex((await p.getBytes(100)).bytes)).toBe(
      'fa6b3c292b4b21f939f469bb6f083234d7523183e1c026bec91b8a7a14252e23' +
        'e339e1e7734cdc773c06305356f32ed2c7a499cc374df11e8a7ef90c903fb110' +
        'b8467ea6dba1ced87087e2f371d83fce4fe660cec6e9ee5dfaa278b2ac8da831' +
        '03592e42',
    )
    // a request above 2^16 bytes is split into SP 800-90A generate calls
    const big = (await p.getBytes(70_000)).bytes
    expect(hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(big))))).toBe(
      'cffb3f4c4cb2ac9a442fc572c2bc99d7e415b29a38a8b6654a2efd8c2e891bef',
    )
  })

  test('byte personalization (32 bytes) with the CAVP entropy and nonce', async () => {
    const personalization = Uint8Array.from({ length: 32 }, (_, i) => 100 + i)
    const p = drbgProvider({ seed: fromHex(CAVP_ENTROPY + CAVP_NONCE), personalization })
    expect(hex((await p.getBytes(64)).bytes)).toBe(
      '5d0574211c6a94406caa960110d65209ea467f0a58330ac632558154be91d4a3' +
        'c74173d29141d878ae09b98a2759d9d7422ce04f25a9a222c1454fcd023121e1',
    )
  })

  test('without personalization', async () => {
    const p = drbgProvider({ seed: SEED })
    expect(hex((await p.getBytes(16)).bytes)).toBe('0ffb80875a3e9022a4941a3fa1b0d361')
  })

  test('a stream replays deterministically per chunk size', async () => {
    const read = async () => {
      const chunks: string[] = []
      for await (const chunk of drbgProvider({ seed: SEED, personalization: 'mindpeeker' }).stream({
        chunkBytes: 32,
      })) {
        chunks.push(hex(chunk))
        if (chunks.length === 2) break
      }
      return chunks
    }
    const expected = [
      'c3788d4cc7c603c4b396060af06a6f1329d6ac5a72e126b5b5b70a7f52311532',
      'fa6b3c292b4b21f939f469bb6f083234d7523183e1c026bec91b8a7a14252e23',
    ]
    expect(await read()).toEqual(expected)
    expect(await read()).toEqual(expected)
  })

  test('concurrent calls are serialized in call order', async () => {
    const p = drbgProvider({ seed: SEED, personalization: 'mindpeeker' })
    const [a, b] = await Promise.all([p.getBytes(32), p.getBytes(32)])
    expect(hex(a.bytes)).toBe('c3788d4cc7c603c4b396060af06a6f1329d6ac5a72e126b5b5b70a7f52311532')
    expect(hex(b.bytes)).toBe('fa6b3c292b4b21f939f469bb6f083234d7523183e1c026bec91b8a7a14252e23')
  })

  test('the seed is copied: mutating the caller array later changes nothing', async () => {
    const seed = new Uint8Array(SEED)
    const p = drbgProvider({ seed })
    seed.fill(0)
    expect(hex((await p.getBytes(16)).bytes)).toBe('0ffb80875a3e9022a4941a3fa1b0d361')
  })

  test('name carries a seed fingerprint (first 4 bytes of SHA-256(seed)); kind csprng', () => {
    const p = drbgProvider({ seed: SEED })
    expect(p.name).toBe('hmac-drbg(seed:4dbdc2b2)')
    expect(drbgProvider({ seed: fromHex(CAVP_ENTROPY + CAVP_NONCE) }).name).toBe(
      'hmac-drbg(seed:1dfc096d)',
    )
    expect(p.kind).toBe('csprng')
    expect(p.privacy).toBe('private')
  })

  test('validates the seed and personalization', () => {
    for (const opts of [
      { seed: new Uint8Array(31) },
      { seed: 'not bytes' as unknown as Uint8Array },
      { seed: SEED, personalization: 42 as unknown as string },
    ]) {
      expect(() => drbgProvider(opts)).toThrow(EntropyError)
    }
  })

  test('a request aborted before its turn does not advance the state', async () => {
    const p = drbgProvider({ seed: SEED, personalization: 'mindpeeker' })
    const controller = new AbortController()
    const first = p.getBytes(32)
    const aborted = p.getBytes(32, { signal: controller.signal })
    controller.abort()
    expect(((await aborted.catch((e) => e)) as EntropyError).code).toBe('aborted')
    await first
    expect(hex((await p.getBytes(32)).bytes)).toBe(
      'fa6b3c292b4b21f939f469bb6f083234d7523183e1c026bec91b8a7a14252e23',
    )
  })
})
