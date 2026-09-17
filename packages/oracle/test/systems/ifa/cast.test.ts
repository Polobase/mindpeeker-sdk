import { describe, expect, test } from 'bun:test'
import type { OracleError } from '../../../src/errors.js'
import { castOdu } from '../../../src/systems/ifa/cast.js'
import { liveSource } from '../../helpers/byte-sources.js'

describe('castOdu', () => {
  test('Bascom 1969 Figure 2 (ikin): marks in order R L R L … give Okanran Irete', async () => {
    // Figure 2 A numbers the marks 1 top-right, 2 top-left, 3/4 second row, …;
    // Figure 2 B: right column II II II I (Okanran), left column I I II I (Irete).
    // Marks in order: II I II I II II I I → bits 0 1 0 1 0 0 1 1 = 0x53.
    const cast = await castOdu(new Uint8Array([0x53]), { method: 'ikin' })
    expect(cast.right.name).toBe('Okanran')
    expect(cast.left.name).toBe('Irete')
    expect(cast.name).toBe('Okanran Irete')
    expect(cast.meji).toBe(false)
    expect(cast.marks).toEqual([0, 1, 0, 1, 0, 0, 1, 1])
    expect(cast.bytesConsumed).toBe(1)
    expect(cast.bitsUsed).toBe(8)
  })

  test('opele (default) reads the right four shells, then the left four', async () => {
    const cast = await castOdu(new Uint8Array([0x53]))
    expect(cast.method).toBe('opele')
    expect(cast.right.binary).toBe('0101') // Ofun
    expect(cast.left.binary).toBe('0011') // Owonrin
    expect(cast.name).toBe('Ofun Owonrin')
    expect((await castOdu(new Uint8Array([0xff]))).name).toBe('Ogbe Meji')
    expect((await castOdu(new Uint8Array([0x00]), { method: 'ikin' })).name).toBe('Oyeku Meji')
  })

  test('exhaustive: each method maps the 256 bytes one-to-one onto the 256 figures', async () => {
    for (const method of ['opele', 'ikin'] as const) {
      const names = new Set<string>()
      let meji = 0
      for (let v = 0; v < 256; v++) {
        const cast = await castOdu(new Uint8Array([v]), { method })
        names.add(`${cast.right.id}/${cast.left.id}`)
        if (cast.meji) meji++
        expect(Object.isFrozen(cast.marks)).toBe(true)
      }
      expect(names.size).toBe(256)
      expect(meji).toBe(16)
    }
  })

  test('closes the stream it opened; rejects unknown methods', async () => {
    const source = liveSource('opele')
    await castOdu(source)
    expect(source.finalized).toBe(1)
    for (const method of ['dice', 'constructor', null]) {
      try {
        await castOdu(new Uint8Array([0]), { method: method as never })
        expect.unreachable()
      } catch (err) {
        expect((err as OracleError).code).toBe('invalid_input')
      }
    }
  })
})
