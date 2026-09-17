import { describe, expect, test } from 'bun:test'
import { vettedOutputEntropy } from '../../src/extract/accounting.js'
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

  test('an empty or non-byte key is a typed error, not a DOMException', async () => {
    await expect(hmacCondition(new Uint8Array(0), utf8('x'))).rejects.toMatchObject({
      name: 'NegentropyError',
      code: 'invalid_config',
    })
    await expect(hmacCondition('key' as never, utf8('x'))).rejects.toMatchObject({
      code: 'invalid_config',
    })
    await expect(sha256Condition([1, 2] as never)).rejects.toMatchObject({ code: 'invalid_config' })
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
    expect(hex(mac as Uint8Array)).toBe(hex(await hmacCondition(utf8('occult-key'), raw)))
    await expect(
      conditionStream(chunked(raw, 64), { minEntropyPerByte: 4, mode: 'hmac' }).next(),
    ).rejects.toMatchObject({ code: 'invalid_config' })
    await expect(
      conditionStream(chunked(raw, 64), {
        minEntropyPerByte: 4,
        mode: 'hmac',
        key: new Uint8Array(0),
      }).next(),
    ).rejects.toMatchObject({ code: 'invalid_config' })
  })

  test('output is independent of chunking: one digest per ⌈safetyFactor·256/h⌉ raw bytes', async () => {
    // h = 3 → ⌈512/3⌉ = 171 bytes per block; 1000 bytes → 5 blocks, 145 dropped
    const raw = prngBytes(1000, 0x66)
    const reference = await Promise.all(
      [0, 1, 2, 3, 4].map(async (b) =>
        hex(await sha256Condition(raw.slice(b * 171, (b + 1) * 171))),
      ),
    )
    for (const size of [1, 7, 170, 171, 172, 342, 1000]) {
      const blocks = await collect(conditionStream(chunked(raw, size), { minEntropyPerByte: 3 }))
      expect(blocks.map(hex)).toEqual(reference)
    }
  })

  test('pooling is linear: a 1 MiB single chunk conditions quickly (0.1.x: ~25 s)', async () => {
    const raw = new Uint8Array(1 << 20)
    for (let i = 0; i < raw.length; i += 65536) raw.set(prngBytes(65536, 0x900 + i), i)
    async function* one(): AsyncGenerator<Uint8Array> {
      yield raw
    }
    const started = performance.now()
    let count = 0
    let last: Uint8Array | undefined
    for await (const block of conditionStream(one(), { minEntropyPerByte: 8, safetyFactor: 1 })) {
      count++
      last = block
    }
    expect(count).toBe((1 << 20) / 32)
    expect(hex(last as Uint8Array)).toBe(hex(await sha256Condition(raw.subarray(raw.length - 32))))
    expect(performance.now() - started).toBeLessThan(5_000) // ~0.1 s linear; O(N²) pooling took ~25 s
  })

  test('the documented per-block credits are SP 800-90B Output_Entropy', () => {
    const credit = (h: number, safety: number) => {
      const n = Math.ceil((safety * 256) / h)
      return vettedOutputEntropy(h * n, 256, 8 * n)
    }
    expect(credit(8, 2)).toBeCloseTo(255.744, 9)
    expect(credit(8, 1)).toBeCloseTo(251.68976456872704, 9)
    expect(credit(4, 1)).toBeCloseTo(255, 12)
  })

  test('validates configuration', async () => {
    const raw = chunked(prngBytes(10), 10)
    await expect(conditionStream(raw, { minEntropyPerByte: 0 }).next()).rejects.toMatchObject({
      code: 'invalid_config',
    })
    await expect(
      conditionStream(chunked(prngBytes(10), 10), { minEntropyPerByte: 9 }).next(),
    ).rejects.toMatchObject({ code: 'invalid_config' })
    await expect(
      conditionStream(chunked(prngBytes(10), 10), {
        minEntropyPerByte: 4,
        safetyFactor: 0.5,
      }).next(),
    ).rejects.toMatchObject({ code: 'invalid_config' })
  })

  test('abort pre-empts a blocked upstream and closes it', async () => {
    const controller = new AbortController()
    let finalized = false
    async function* blocked(): AsyncGenerator<Uint8Array> {
      try {
        yield prngBytes(64, 1)
        await new Promise<void>((resolve) => {
          controller.signal.addEventListener('abort', () => resolve(), { once: true })
        })
      } finally {
        finalized = true
      }
    }
    const stream = conditionStream(blocked(), { minEntropyPerByte: 8, signal: controller.signal })
    await stream.next() // block from the first 64 bytes
    const pending = stream.next()
    await Bun.sleep(5)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    expect(finalized).toBe(true)
  })

  test('upstream errors are wrapped as source_failed; non-byte chunks are invalid_config', async () => {
    const boom = new Error('socket reset')
    async function* failing(): AsyncGenerator<Uint8Array> {
      yield prngBytes(10, 2)
      throw boom
    }
    await expect(
      collect(conditionStream(failing(), { minEntropyPerByte: 8 })),
    ).rejects.toMatchObject({
      code: 'source_failed',
      cause: boom,
    })
    async function* strings(): AsyncGenerator<Uint8Array> {
      yield 'abc' as never
    }
    await expect(
      collect(conditionStream(strings(), { minEntropyPerByte: 8 })),
    ).rejects.toMatchObject({
      code: 'invalid_config',
    })
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
    await expect(stream.next()).rejects.toMatchObject({ code: 'aborted' })
  })
})
