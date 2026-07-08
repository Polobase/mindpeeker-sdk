import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { conditionStream, hmacCondition, sha256Condition } from '../../src/extract/condition.js'
import { prngBytes } from '../helpers/byte-sources.js'

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const utf8 = (s: string) => new TextEncoder().encode(s)

describe('sha256Condition (FIPS 180-2 vectors)', () => {
  test('"abc"', async () => {
    expect(hex(await sha256Condition(utf8('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  test('empty input', async () => {
    expect(hex(await sha256Condition(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })
})

describe('hmacCondition (RFC 4231 vectors)', () => {
  test('case 1: 20×0x0b key, "Hi There"', async () => {
    expect(hex(await hmacCondition(new Uint8Array(20).fill(0x0b), utf8('Hi There')))).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    )
  })

  test('case 2: key "Jefe"', async () => {
    expect(hex(await hmacCondition(utf8('Jefe'), utf8('what do ya want for nothing?')))).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    )
  })
})

async function collect(stream: AsyncGenerator<Uint8Array>): Promise<Uint8Array[]> {
  const out: Uint8Array[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

async function* chunked(bytes: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
  for (let i = 0; i < bytes.length; i += size) yield bytes.slice(i, i + size)
}

describe('conditionStream', () => {
  test('pools ⌈safetyFactor·256/h⌉ bytes per 32-byte block; underfilled tail dropped', async () => {
    // h=4 bits/byte, safety 2 → 128 raw bytes per block; 300 bytes → 2 blocks + 44 dropped
    const raw = prngBytes(300, 0x44)
    const blocks = await collect(
      conditionStream(chunked(raw, 37), { minEntropyPerByte: 4, safetyFactor: 2 }),
    )
    expect(blocks.length).toBe(2)
    for (const block of blocks) expect(block.length).toBe(32)
    // deterministic: first block is SHA-256 of the first 128 raw bytes
    expect(hex(blocks[0] as Uint8Array)).toBe(hex(await sha256Condition(raw.slice(0, 128))))
    expect(hex(blocks[1] as Uint8Array)).toBe(hex(await sha256Condition(raw.slice(128, 256))))
  })

  test('hmac mode differs from sha256 mode and needs a key', async () => {
    const raw = prngBytes(128, 0x55)
    const [sha] = await collect(conditionStream(chunked(raw, 64), { minEntropyPerByte: 4 }))
    const [mac] = await collect(
      conditionStream(chunked(raw, 64), {
        minEntropyPerByte: 4,
        mode: 'hmac',
        key: utf8('occult-key'),
      }),
    )
    expect(hex(mac as Uint8Array)).not.toBe(hex(sha as Uint8Array))
    expect(
      conditionStream(chunked(raw, 64), { minEntropyPerByte: 4, mode: 'hmac' }).next(),
    ).rejects.toMatchObject({ code: 'invalid_config' })
  })

  test('validates configuration', () => {
    const raw = chunked(prngBytes(10), 10)
    expect(conditionStream(raw, { minEntropyPerByte: 0 }).next()).rejects.toMatchObject({
      code: 'invalid_config',
    })
    expect(
      conditionStream(chunked(prngBytes(10), 10), { minEntropyPerByte: 9 }).next(),
    ).rejects.toMatchObject({ code: 'invalid_config' })
    expect(
      conditionStream(chunked(prngBytes(10), 10), {
        minEntropyPerByte: 4,
        safetyFactor: 0.5,
      }).next(),
    ).rejects.toMatchObject({ code: 'invalid_config' })
  })

  test('aborts between chunks', async () => {
    const controller = new AbortController()
    async function* endless(): AsyncGenerator<Uint8Array> {
      let round = 1
      while (true) yield prngBytes(32, round++)
    }
    const stream = conditionStream(endless(), {
      minEntropyPerByte: 8,
      signal: controller.signal,
    })
    await stream.next()
    controller.abort()
    expect(stream.next()).rejects.toMatchObject({ code: 'aborted' })
  })
})
