import { describe, expect, test } from 'bun:test'
import { castMo, MO_SYLLABLES } from '../../../src/systems/mo/cast.js'

describe('castMo (Mipham, tr. Goldberg & Dakpa 1990)', () => {
  test('syllables in mantra order with the ordinary-die equivalents', () => {
    expect(MO_SYLLABLES.map((s) => `${s.syllable} ${s.pips}`)).toEqual([
      'AH 6',
      'RA 2',
      'PA 3',
      'TSA 5',
      'NA 4',
      'DHI 1',
    ])
    expect(new Set(MO_SYLLABLES.map((s) => s.pips)).size).toBe(6)
  })

  test("the book's example: RA then DHI is answer 12", async () => {
    const cast = await castMo(new Uint8Array([1, 5]))
    expect([cast.first.syllable, cast.second.syllable]).toEqual(['RA', 'DHI'])
    expect(cast.number).toBe(12)
    expect(cast.bytesConsumed).toBe(2)
    expect(cast.bitsUsed).toBe(16)
  })

  test('key numbering: AH AH 1, AH RA 2, PA DHI 18, TSA RA 20, DHI DHI 36; rejection spends a byte', async () => {
    expect((await castMo(new Uint8Array([0, 0]))).number).toBe(1)
    expect((await castMo(new Uint8Array([0, 1]))).number).toBe(2)
    expect((await castMo(new Uint8Array([2, 5]))).number).toBe(18)
    expect((await castMo(new Uint8Array([3, 1]))).number).toBe(20)
    const last = await castMo(new Uint8Array([252, 5, 5]))
    expect(last.number).toBe(36)
    expect(last.bytesConsumed).toBe(3)
  })

  test('exhaustive over accepted byte pairs: each of the 36 answers exactly 42² times', async () => {
    const counts = new Array<number>(37).fill(0)
    for (let a = 0; a < 252; a++) {
      for (let b = 0; b < 252; b++) {
        const n = (await castMo(new Uint8Array([a, b]))).number
        counts[n] = (counts[n] as number) + 1
      }
    }
    expect(counts.slice(1)).toEqual(new Array<number>(36).fill(42 * 42))
  })
})
