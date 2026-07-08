import { describe, expect, test } from 'bun:test'
import { base32Decode, base58Decode, cidDigest, readVarint } from '../../src/internal/encoding.js'

const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)))

describe('base58Decode', () => {
  test('decodes the classic bitcoin test vectors', () => {
    expect(base58Decode('')).toEqual(new Uint8Array(0))
    expect(base58Decode('2g')).toEqual(new Uint8Array([0x61]))
    expect(base58Decode('a3gV')).toEqual(ascii('bbb'))
    expect(base58Decode('aPEr')).toEqual(ascii('ccc'))
    expect(base58Decode('StV1DL6CwTryKyV')).toEqual(ascii('hello world'))
    expect(base58Decode('1233QC4')).toEqual(new Uint8Array([0x00, 0x28, 0x7f, 0xb4, 0xcd]))
  })

  test('maps leading 1s to zero bytes', () => {
    expect(base58Decode('11')).toEqual(new Uint8Array([0, 0]))
  })

  test('rejects characters outside the base58 alphabet', () => {
    for (const bad of ['0', 'O', 'I', 'l', 'hello world']) {
      expect(() => base58Decode(bad)).toThrow(TypeError)
    }
  })
})

describe('base32Decode', () => {
  test('decodes RFC 4648 vectors (lowercase, unpadded)', () => {
    expect(base32Decode('')).toEqual(new Uint8Array(0))
    expect(base32Decode('my')).toEqual(ascii('f'))
    expect(base32Decode('mzxq')).toEqual(ascii('fo'))
    expect(base32Decode('mzxw6')).toEqual(ascii('foo'))
    expect(base32Decode('mzxw6yq')).toEqual(ascii('foob'))
    expect(base32Decode('mzxw6ytb')).toEqual(ascii('fooba'))
    expect(base32Decode('mzxw6ytboi')).toEqual(ascii('foobar'))
  })

  test('rejects characters outside the lowercase alphabet', () => {
    expect(() => base32Decode('MY')).toThrow(TypeError)
    expect(() => base32Decode('m1')).toThrow(TypeError)
    expect(() => base32Decode('m8')).toThrow(TypeError)
  })
})

describe('readVarint', () => {
  test('decodes unsigned LEB128', () => {
    expect(readVarint(new Uint8Array([0x01]), 0)).toEqual([1, 1])
    expect(readVarint(new Uint8Array([0x80, 0x01]), 0)).toEqual([128, 2])
    expect(readVarint(new Uint8Array([0xac, 0x02]), 0)).toEqual([300, 2])
    expect(readVarint(new Uint8Array([0xff, 0xac, 0x02]), 1)).toEqual([300, 3])
  })

  test('throws on truncated input', () => {
    expect(() => readVarint(new Uint8Array([0x80]), 0)).toThrow(TypeError)
  })
})

describe('cidDigest', () => {
  test('extracts the multihash digest of a CIDv1 (well-known raw/sha2-256 of empty)', () => {
    const digest = cidDigest('bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku')
    // SHA-256 of the empty string
    expect(Buffer.from(digest).toString('hex')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(digest.length).toBe(32)
  })

  test('rejects CIDv0 and unknown multibase prefixes', () => {
    expect(() => cidDigest('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG')).toThrow(TypeError)
    expect(() => cidDigest('zb2rhe5P4gXftAwvA4eXQ5HJwsER2owDyS9sKaQRRVQPn93bA')).toThrow(TypeError)
  })
})
