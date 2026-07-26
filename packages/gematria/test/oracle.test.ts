import { describe, expect, test } from 'bun:test'
import { GematriaError } from '../src/errors.js'
import { castByValue, castGematria, drawByValue, drawWord } from '../src/oracle.js'
import { value } from '../src/value.js'
import { bytesSource, prngBytes } from './helpers/byte-sources.js'

const LEXICON = ['אחד', 'אהבה', 'חי', 'יהוה', 'לב', 'טוב']

describe('drawWord', () => {
  test('is deterministic in its input bytes', async () => {
    const a = await drawWord(LEXICON, prngBytes(64, 1))
    const b = await drawWord(LEXICON, prngBytes(64, 1))
    expect(a.word).toBe(b.word)
    expect(LEXICON).toContain(a.word)
  })

  test('reports byte-level accounting (bitsUsed = 8 · bytesConsumed)', async () => {
    const r = await drawWord(LEXICON, prngBytes(64, 5))
    expect(r.bytesConsumed).toBeGreaterThan(0)
    expect(r.bitsUsed).toBe(r.bytesConsumed * 8)
  })

  test('a one-word lexicon consumes zero entropy', async () => {
    const r = await drawWord(['אחד'], prngBytes(8, 7))
    expect(r).toEqual({ word: 'אחד', bytesConsumed: 0, bitsUsed: 0 })
  })

  test('works from a named ByteSource too', async () => {
    const r = await drawWord(LEXICON, bytesSource('seeded', prngBytes(64, 1)))
    expect(LEXICON).toContain(r.word)
  })

  test('rejects an empty lexicon', async () => {
    await expect(drawWord([], prngBytes(8))).rejects.toBeInstanceOf(GematriaError)
  })
})

describe('drawByValue', () => {
  test('draws only among words of the target value and returns its result', async () => {
    const r = await drawByValue(LEXICON, 'he-hechrachi', 13, prngBytes(64, 2))
    expect(['אחד', 'אהבה']).toContain(r.word) // both value 13
    expect(r.result.value).toBe(13)
    expect(r.targetValue).toBe(13)
    expect(value(r.word, 'he-hechrachi')).toBe(13)
    expect(r.bitsUsed).toBe(r.bytesConsumed * 8)
  })

  test('throws no_match when no word has the target value', async () => {
    const promise = drawByValue(LEXICON, 'he-hechrachi', 99999, prngBytes(64, 3))
    await expect(promise).rejects.toMatchObject({ code: 'no_match' })
  })

  test('rejects a non-integer target', async () => {
    await expect(drawByValue(LEXICON, 'he-hechrachi', 1.5, prngBytes(8))).rejects.toBeInstanceOf(
      GematriaError,
    )
  })
})

describe('castGematria', () => {
  test('draws a word and returns its profile, value, and equal-value peers', async () => {
    const cast = await castGematria(LEXICON, 'he-hechrachi', prngBytes(64, 2))
    expect(LEXICON).toContain(cast.word)
    expect(cast.value).toBe(value(cast.word, 'he-hechrachi'))
    expect(cast.profile.script).toBe('hebrew')
    expect(cast.profile.values.length).toBe(6)
    // the drawn word is among its own matches; commonness is a valid fraction
    expect(cast.matches).toContain(cast.word)
    expect(cast.commonness).toBeGreaterThan(0)
    expect(cast.commonness).toBeLessThanOrEqual(1)
    expect(cast.bitsUsed).toBe(cast.bytesConsumed * 8)
  })

  test('is deterministic in its input bytes', async () => {
    const a = await castGematria(LEXICON, 'he-hechrachi', prngBytes(64, 11))
    const b = await castGematria(LEXICON, 'he-hechrachi', prngBytes(64, 11))
    expect(a.word).toBe(b.word)
    expect(a.value).toBe(b.value)
  })
})

describe('castByValue', () => {
  // Hechrachi: echad=13, ahavah=13, chai=18, YHVH=26, lev=32, tov=17
  test('is deterministic in its input bytes', async () => {
    const a = await castByValue(LEXICON, 'he-hechrachi', prngBytes(64, 4))
    const b = await castByValue(LEXICON, 'he-hechrachi', prngBytes(64, 4))
    expect(a.value).toBe(b.value)
    expect(a.words).toEqual(b.words)
  })

  test('default lexicon mode always resolves to at least one word', async () => {
    for (let seed = 0; seed < 20; seed++) {
      const cast = await castByValue(LEXICON, 'he-hechrachi', prngBytes(64, seed))
      expect(cast.words.length).toBeGreaterThan(0)
      expect(cast.words).toEqual(LEXICON.filter((w) => value(w, 'he-hechrachi') === cast.value))
      expect(cast.commonness).toBeGreaterThan(0)
    }
  })

  test('reports byte-level accounting and the resolved canonical cipher id', async () => {
    // an English lexicon so 'jewish' sees more than one distinct value
    const cast = await castByValue(['god', 'dog', 'cat'], 'jewish', prngBytes(64, 9))
    expect(cast.cipher).toBe('la-jewish')
    expect(cast.bytesConsumed).toBeGreaterThan(0)
    expect(cast.bitsUsed).toBe(cast.bytesConsumed * 8)
  })

  test('range mode draws uniformly over [min, max] and may be empty', async () => {
    const cast = await castByValue(LEXICON, 'he-hechrachi', prngBytes(64, 3), {
      mode: 'range',
      min: 1000,
      max: 1000,
    })
    expect(cast.value).toBe(1000)
    expect(cast.words).toEqual([])
    expect(cast.commonness).toBe(0)
  })

  test('range mode defaults to [1, lexicon max]', async () => {
    const cast = await castByValue(LEXICON, 'he-hechrachi', prngBytes(64, 6), { mode: 'range' })
    expect(cast.value).toBeGreaterThanOrEqual(1)
    expect(cast.value).toBeLessThanOrEqual(32) // lev=32 is the lexicon's max
  })

  test('rejects an invalid range', async () => {
    const promise = castByValue(LEXICON, 'he-hechrachi', prngBytes(8), {
      mode: 'range',
      min: 10,
      max: 5,
    })
    await expect(promise).rejects.toBeInstanceOf(GematriaError)
  })

  test('rejects an empty lexicon', async () => {
    await expect(castByValue([], 'he-hechrachi', prngBytes(8))).rejects.toBeInstanceOf(
      GematriaError,
    )
  })
})
