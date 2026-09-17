import { describe, expect, test } from 'bun:test'
import { type ByteSource, byteReader, OracleError } from '@mindpeeker/oracle'
import { GematriaError } from '../src/errors.js'
import { defaultLexicon } from '../src/lexicon.js'
import {
  type CastByValueOptions,
  castByValue,
  castGematria,
  drawByValue,
  drawWord,
} from '../src/oracle.js'
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
    expect(r).toMatchObject({ word: 'אחד', bytesConsumed: 0, bitsUsed: 0 })
  })

  test('accepts { word, script } entries', async () => {
    const r = await drawWord([{ word: 'אחד', script: 'hebrew' }, 'חי'], new Uint8Array([0]))
    expect(r.word).toBe('אחד')
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

// ---------------------------------------------------------------------------
// 0.2.0: admissible words, colel/tolerance, validation before entropy, reader
// lifecycle and error mapping.
// ---------------------------------------------------------------------------

/** A ByteSource that records how often it was opened and whether its stream was released. */
function trackedSource(bytes: Uint8Array | ((signal?: AbortSignal) => AsyncGenerator<Uint8Array>)) {
  const state = { opened: 0, released: 0 }
  const source: ByteSource = {
    name: 'tracked',
    async *stream(opts) {
      state.opened++
      try {
        if (typeof bytes === 'function') yield* bytes(opts?.signal)
        else yield bytes
      } finally {
        state.released++
      }
    },
  }
  return { source, state }
}

/** A stream that delivers nothing until the forwarded signal aborts it. */
function stalledSource() {
  return trackedSource(async function* (signal) {
    await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve()))
    yield new Uint8Array(0)
  })
}

describe('admissible words in the cipher-bound draws', () => {
  const MIXED = ['אחד', 'Αμην', 'Thelema', 'אהבה', 'חי']

  test('castGematria never draws a word its cipher cannot score', async () => {
    for (let b = 0; b < 256; b++) {
      const cast = await castGematria(MIXED, 'he-hechrachi', new Uint8Array([b, b, b, b])).catch(
        () => undefined,
      )
      if (!cast) continue
      expect(['אחד', 'אהבה', 'חי']).toContain(cast.word)
      expect(cast.value).toBeGreaterThan(0)
      expect(cast.lexiconSize).toBe(3)
    }
  })

  test('castByValue with the bundled lexicon never lands on value 0', async () => {
    const lexicon = defaultLexicon()
    for (let b = 0; b < 256; b += 3) {
      const cast = await castByValue(lexicon, 'he-hechrachi', new Uint8Array([b, 7, 11, 13]))
      expect(cast.value).toBeGreaterThan(0)
      expect(cast.words.length).toBeGreaterThan(0)
      expect(cast.lexiconSize).toBe(160)
    }
  })

  test('the default-lexicon overload reads the registered corpus', async () => {
    defaultLexicon()
    const cast = await castByValue('isopsephy', new Uint8Array([0]))
    expect(cast.cipher).toBe('gr-isopsephy')
    expect(cast.value).toBe(30) // the smallest Greek value, Δεκα
    expect(cast.words).toEqual(['Δεκα'])
  })

  test('lexicon mode is uniform over distinct values, not words (256-byte sweep: 128/128)', async () => {
    const lexicon = ['אחד', 'אהבה', 'חי'] // 13, 13, 18
    const counts = new Map<number, number>()
    for (let b = 0; b < 256; b++) {
      const cast = await castByValue(lexicon, 'he-hechrachi', new Uint8Array([b]))
      counts.set(cast.value, (counts.get(cast.value) ?? 0) + 1)
    }
    expect(counts.get(13)).toBe(128)
    expect(counts.get(18)).toBe(128)
  })

  test('no admissible word rejects with no_match before any entropy is read', async () => {
    const { source, state } = trackedSource(prngBytes(16))
    await expect(castGematria(['Αμην'], 'he-hechrachi', source)).rejects.toMatchObject({
      code: 'no_match',
    })
    await expect(castByValue(['Αμην'], 'he-hechrachi', source)).rejects.toMatchObject({
      code: 'no_match',
    })
    expect(state.opened).toBe(0)
  })
})

describe('colel / tolerance in the draws', () => {
  const LEX = ['אחד', 'דוד', 'גדול'] // 13, 14, 43

  test('drawByValue widens the candidates and reports the window', async () => {
    const seen = new Set<string>()
    for (let b = 0; b < 256; b += 17) {
      const r = await drawByValue(LEX, 'he-hechrachi', 14, new Uint8Array([b]), { colel: true })
      expect(r.tolerance).toBe(1)
      seen.add(r.word)
    }
    expect([...seen].sort()).toEqual(['דוד', 'אחד'].sort())
    await expect(drawByValue(LEX, 'he-hechrachi', 12, new Uint8Array([0]))).rejects.toMatchObject({
      code: 'no_match',
    })
  })

  test('castByValue and castGematria report words within tolerance and the exact subset', async () => {
    const cast = await castByValue(LEX, 'he-hechrachi', new Uint8Array([0]), { tolerance: 1 })
    expect(cast.value).toBe(13)
    expect(cast.words).toEqual(['אחד', 'דוד'])
    expect(cast.exact).toEqual(['אחד'])
    expect(cast.commonness).toBeCloseTo(2 / 3, 12)
    const reading = await castGematria(LEX, 'he-hechrachi', new Uint8Array([1]), { colel: true })
    expect(reading.word).toBe('דוד')
    expect(reading.matches).toEqual(['אחד', 'דוד'])
    expect(reading.exact).toEqual(['דוד'])
  })
})

describe('validation happens before any entropy is read', () => {
  test('castByValue range bounds: negative min, max beyond 2^48, too wide, non-integers', async () => {
    const { source, state } = trackedSource(prngBytes(64))
    for (const range of [
      { min: -10, max: 10 },
      { min: 0, max: 2 ** 49 },
      { min: 0, max: 2 ** 48 },
      { min: 1.5, max: 3 },
      { min: 10, max: 5 },
    ]) {
      await expect(
        castByValue(LEXICON, 'he-hechrachi', source, { mode: 'range', ...range }),
      ).rejects.toMatchObject({ name: 'GematriaError', code: 'invalid_input' })
    }
    const badMode = { mode: 'nope' } as unknown as CastByValueOptions
    await expect(castByValue(LEXICON, 'he-hechrachi', source, badMode)).rejects.toMatchObject({
      code: 'invalid_input',
    })
    expect(state.opened).toBe(0)
  })

  test('the widest allowed range (2^48 values) draws without an OracleError', async () => {
    const cast = await castByValue(LEXICON, 'he-hechrachi', prngBytes(64, 9), {
      mode: 'range',
      min: 1,
      max: 2 ** 48,
    })
    expect(cast.value).toBeGreaterThanOrEqual(1)
    expect(cast.value).toBeLessThanOrEqual(2 ** 48)
    expect(cast.numbers.value).toBe(cast.value)
  })

  test('the default range max is found without spreading a million values', async () => {
    const letters = 'abcdefghijklmnopqrstuvwxyz'
    const lexicon = Array.from({ length: 1_000_000 }, (_, i) => letters[i % 26] as string)
    const cast = await castByValue(lexicon, 'en-ordinal', new Uint8Array([25]), { mode: 'range' })
    expect(cast.value).toBe(26)
    expect(cast.lexiconSize).toBe(1_000_000)
  })

  test('targets, options and signals are type-checked', async () => {
    await expect(drawByValue(LEXICON, 'he-hechrachi', -1, prngBytes(8))).rejects.toMatchObject({
      code: 'invalid_input',
    })
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    await expect(drawWord(LEXICON, prngBytes(8), { signal: {} as any })).rejects.toMatchObject({
      code: 'invalid_input',
    })
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    await expect(drawWord(LEXICON, prngBytes(8), 'fast' as any)).rejects.toBeInstanceOf(
      GematriaError,
    )
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    await expect(drawWord([1] as any, prngBytes(8))).rejects.toBeInstanceOf(GematriaError)
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    await expect(castGematria(LEXICON, 'nope' as any, prngBytes(8))).rejects.toMatchObject({
      code: 'unknown_cipher',
    })
  })
})

describe('resolved cipher ids', () => {
  test('drawByValue and castGematria echo the canonical id for an alias', async () => {
    const r = await drawByValue(['god', 'dog', 'cat'], 'jewish', 61, prngBytes(8))
    expect(r.cipher).toBe('la-jewish')
    expect(r.result.cipher).toBe('la-jewish')
    const cast = await castGematria(['god', 'dog', 'cat'], 'jewish', prngBytes(8))
    expect(cast.cipher).toBe('la-jewish')
  })
})

describe('abort, reader lifecycle and error mapping', () => {
  test('a pre-aborted signal rejects even when no bytes are needed', async () => {
    const signal = AbortSignal.abort()
    await expect(drawWord(['אחד'], prngBytes(8), { signal })).rejects.toMatchObject({
      name: 'GematriaError',
      code: 'aborted',
    })
    await expect(
      castByValue(['אחד'], 'he-hechrachi', prngBytes(8), { signal }),
    ).rejects.toMatchObject({ code: 'aborted' })
  })

  test('aborting a stalled source rejects with aborted and releases the stream', async () => {
    const { source, state } = stalledSource()
    const controller = new AbortController()
    const pending = drawWord(LEXICON, source, { signal: controller.signal })
    setTimeout(() => controller.abort(), 5)
    const error = await pending.catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GematriaError)
    expect(error).toMatchObject({ code: 'aborted' })
    expect((error as GematriaError).cause).toBeInstanceOf(OracleError)
    expect(state.opened).toBe(1)
    expect(state.released).toBe(1)
  })

  test('a stream opened for the draw is closed after success and after failure', async () => {
    const ok = trackedSource(prngBytes(64, 3))
    await drawWord(LEXICON, ok.source)
    expect(ok.state).toEqual({ opened: 1, released: 1 })

    const infinite = trackedSource(async function* () {
      for (;;) yield prngBytes(4, 5)
    })
    await castGematria(LEXICON, 'he-hechrachi', infinite.source)
    expect(infinite.state).toEqual({ opened: 1, released: 1 })

    const short = trackedSource(new Uint8Array(0))
    await expect(drawWord(LEXICON, short.source)).rejects.toMatchObject({
      code: 'insufficient_entropy',
    })
    expect(short.state).toEqual({ opened: 1, released: 1 })
  })

  test('a caller-supplied ByteReader stays open; per-draw accounting deltas add up', async () => {
    const reader = byteReader(prngBytes(256, 21))
    const a = await drawWord(LEXICON, reader)
    const b = await castByValue(LEXICON, 'he-hechrachi', reader)
    expect(a.bytesConsumed + b.bytesConsumed).toBe(reader.bytesConsumed)
    await expect(reader.next()).resolves.toBeNumber()
    const controller = new AbortController()
    await drawWord(LEXICON, reader, { signal: controller.signal })
    await expect(reader.next()).resolves.toBeNumber()
  })

  test('insufficient entropy maps to GematriaError with the OracleError as cause', async () => {
    const error = await drawWord(LEXICON, new Uint8Array(0)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GematriaError)
    expect(error).toMatchObject({ code: 'insufficient_entropy' })
    expect((error as GematriaError).cause).toMatchObject({
      name: 'OracleError',
      code: 'insufficient_entropy',
    })
  })

  test('a failing source and a closed reader map to source_error', async () => {
    const boom = new Error('device unplugged')
    const failing: ByteSource = {
      name: 'failing',
      // biome-ignore lint/correctness/useYield: the stream fails before yielding
      async *stream() {
        throw boom
      },
    }
    const failed = await drawWord(LEXICON, failing).catch((e: unknown) => e)
    expect(failed).toMatchObject({ name: 'GematriaError', code: 'source_error' })
    const cause = (failed as GematriaError).cause as OracleError
    expect(cause.code).toBe('source_error')
    expect(cause.cause).toBe(boom)

    const reader = byteReader(prngBytes(64))
    await reader.close()
    const closed = await drawWord(LEXICON, reader).catch((e: unknown) => e)
    expect(closed).toMatchObject({ name: 'GematriaError', code: 'source_error' })
    expect(((closed as GematriaError).cause as OracleError).code).toBe('closed')
  })

  test('an unrecognized entropy input is invalid_input', async () => {
    // biome-ignore lint/suspicious/noExplicitAny: exercising the runtime guard
    await expect(drawWord(LEXICON, 42 as any)).rejects.toMatchObject({
      name: 'GematriaError',
      code: 'invalid_input',
    })
  })
})
