import { describe, expect, test } from 'bun:test'
import { Sha256, toHex } from '../../src/internal/sha256.js'
import { prngBytes } from '../helpers/byte-sources.js'

async function reference(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes)
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', copy)))
}

describe('Sha256 (incremental)', () => {
  test('FIPS 180-2 vectors', () => {
    const enc = new TextEncoder()
    expect(toHex(new Sha256().digest())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(toHex(new Sha256().update(enc.encode('abc')).digest())).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(
      toHex(
        new Sha256()
          .update(enc.encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
          .digest(),
      ),
    ).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
  })

  test('one million "a" fed in uneven pieces', () => {
    const h = new Sha256()
    const a = new Uint8Array(4093).fill(0x61)
    let left = 1_000_000
    while (left > 0) {
      const n = Math.min(left, a.length)
      h.update(a.subarray(0, n))
      left -= n
    }
    expect(toHex(h.digest())).toBe(
      'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0',
    )
  })

  test('matches crypto.subtle for every length 0..300 and any split', async () => {
    for (let n = 0; n <= 300; n++) {
      const bytes = prngBytes(n, 1000 + n)
      const cut = (n * 7) >>> 3
      const got = toHex(
        new Sha256().update(bytes.subarray(0, cut)).update(bytes.subarray(cut)).digest(),
      )
      expect(got).toBe(await reference(bytes))
    }
  })
})
