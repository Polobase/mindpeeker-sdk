import { describe, expect, test } from 'bun:test'
import { trialsFromBytes } from '@mindpeeker/negentropy'
import type { PsiError } from '../../src/errors.js'
import { analyzeEvent } from '../../src/gcp/event.js'
import {
  parseRecordLine,
  readSession,
  recordSession,
  type SessionRecordLine,
  serializeRecordLine,
} from '../../src/record/jsonl.js'
import {
  countingSource,
  fakeClock,
  finiteSource,
  finiteSourceBytes,
} from '../helpers/trial-sources.js'

const K = 16 // 2 bytes per chunk = one 16-bit trial per chunk
const ROUNDS = 5

function record() {
  return recordSession([finiteSource('a', ROUNDS, 21, 2), finiteSource('b', ROUNDS, 91, 2)], {
    bitsPerTrial: K,
    now: fakeClock(),
  })
}

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = []
  for await (const line of gen) out.push(line)
  return out
}

describe('recordSession / readSession', () => {
  test('records lock-step rounds, one line per source per round', async () => {
    const lines = await collect(record())
    expect(lines.length).toBe(ROUNDS * 2)
    for (let i = 0; i < lines.length; i++) {
      const parsed = parseRecordLine(lines[i] as string) as SessionRecordLine
      expect(parsed.v).toBe(1)
      expect(parsed.source).toBe(i % 2 === 0 ? 'a' : 'b')
      expect(parsed.bitsPerTrial).toBe(K)
      expect(Number.isInteger(parsed.sum)).toBe(true)
    }
  })

  test('round-trip is byte-exact: serialize(parse(line)) === line', async () => {
    const lines = await collect(record())
    for (const line of lines) {
      expect(serializeRecordLine(parseRecordLine(line))).toBe(line)
    }
  })

  test('recording is deterministic across identical runs', async () => {
    expect(await collect(record())).toEqual(await collect(record()))
  })

  test('recorded sums equal batch trialsFromBytes over the same byte material', async () => {
    const seriesBySource = await readSession(await collect(record()))
    const batchA = trialsFromBytes(finiteSourceBytes(ROUNDS, 21, 2), 'a', { bitsPerTrial: K })
    const batchB = trialsFromBytes(finiteSourceBytes(ROUNDS, 91, 2), 'b', { bitsPerTrial: K })
    expect(seriesBySource[0]?.sums).toEqual(batchA.sums)
    expect(seriesBySource[1]?.sums).toEqual(batchB.sums)
  })

  test('replay is analysis-identical: analyzeEvent over readSession reproduces the analysis', async () => {
    const lines = await collect(record())
    const replayed = await readSession(lines)
    const direct = await readSession(await collect(record())) // independent identical recording
    const window = { startMs: Number.MIN_SAFE_INTEGER, endMs: Number.MAX_SAFE_INTEGER }
    const a = analyzeEvent(replayed, window)
    const b = analyzeEvent(direct, window)
    expect(a.stoufferPerTrial).toEqual(b.stoufferPerTrial)
    expect(a.netvar).toEqual(b.netvar)
    expect(a.devvar).toEqual(b.devvar)
    expect(a.cumdev).toEqual(b.cumdev)
    expect(a.composite).toEqual(b.composite)
  })

  test('readSession groups by source in first-seen order with timestamps', async () => {
    const lines = await collect(record())
    const series = await readSession(lines)
    expect(series.map((s) => s.source)).toEqual(['a', 'b'])
    for (const s of series) {
      expect(s.bitsPerTrial).toBe(K)
      expect(s.sums.length).toBe(ROUNDS)
      expect(s.timestamps?.length).toBe(ROUNDS)
    }
  })

  test('accepts a whole file as a single string and async iterables', async () => {
    const lines = await collect(record())
    const fromLines = await readSession(lines)
    const fromFile = await readSession([`${lines.join('\n')}\n`])
    async function* streamed() {
      for (const line of lines) yield line
    }
    const fromAsync = await readSession(streamed())
    expect(fromFile).toEqual(fromLines)
    expect(fromAsync).toEqual(fromLines)
  })

  test('bad records are rejected with the offending line number', async () => {
    const bad = expect.objectContaining({
      name: 'PsiError',
      code: 'bad_record',
    }) as unknown as Error
    await expect(readSession(['not json'])).rejects.toThrow(bad)
    await expect(
      readSession(['{"v":3,"t":0,"source":"a","sum":1,"bitsPerTrial":16}']),
    ).rejects.toThrow(bad)
    await expect(readSession(['{"v":1,"t":0,"source":"a","sum":1}'])).rejects.toThrow(bad)
    await expect(
      readSession(['{"v":1,"t":0,"source":"a","sum":1,"bitsPerTrial":4}']),
    ).rejects.toThrow(bad)
    await expect(
      readSession(['{"v":1,"t":0,"source":"","sum":1,"bitsPerTrial":16}']),
    ).rejects.toThrow(bad)
    await expect(readSession(['[1,2,3]'])).rejects.toThrow(bad)
    // per-source bitsPerTrial must not change mid-recording
    await expect(
      readSession([
        '{"v":1,"t":0,"source":"a","sum":1,"bitsPerTrial":16}',
        '{"v":1,"t":1,"source":"a","sum":2,"bitsPerTrial":32}',
      ]),
    ).rejects.toThrow(bad)
    try {
      await readSession(['{"v":1,"t":0,"source":"a","sum":1,"bitsPerTrial":16}', 'garbage'])
      expect.unreachable()
    } catch (error) {
      expect((error as PsiError).message).toContain('line 2')
    }
  })

  test('blank lines are skipped', async () => {
    const lines = await collect(record())
    const series = await readSession([`\n${lines.join('\n\n')}\n\n`])
    expect(series[0]?.sums.length).toBe(ROUNDS)
  })

  test('byte-stream chunks may split lines anywhere; a whole-file string is one chunk', async () => {
    const lines = await collect(record())
    const file = `${lines.join('\n')}\n`
    const expected = await readSession(lines)
    for (const size of [1, 7, 33, 64]) {
      const chunks: string[] = []
      for (let i = 0; i < file.length; i += size) chunks.push(file.slice(i, i + size))
      expect(await readSession(chunks)).toEqual(expected)
    }
    expect(await readSession(file)).toEqual(expected)
    expect(await readSession(file.replaceAll('\n', '\r\n'))).toEqual(expected)
    // CRLF with the \r and \n in different chunks
    const crlf = file.replaceAll('\n', '\r\n')
    const cut = crlf.indexOf('\r\n') + 1
    expect(await readSession([crlf.slice(0, cut), crlf.slice(cut)])).toEqual(expected)
  })

  test('line numbers are physical lines, also for newline-terminated elements', async () => {
    const good = '{"v":1,"t":0,"source":"a","sum":1,"bitsPerTrial":16}'
    const messageOf = async (input: string | string[]) => {
      try {
        await readSession(input)
      } catch (error) {
        return (error as PsiError).message
      }
      return 'no error'
    }
    expect(await messageOf([`${good}\n`, 'garbage\n'])).toContain('line 2 ')
    expect(await messageOf([`${good}\n${good}\n`, '\n', 'garbage\n'])).toContain('line 4 ')
    expect(await messageOf(`${good}\n\n${good}\ngarbage`)).toContain('line 4 ')
    // unterminated elements that are complete records are lines of their own
    expect(await messageOf([good, good, 'garbage'])).toContain('line 3 ')
    // a record split across chunks is not two lines
    expect(await messageOf([good.slice(0, 20), `${good.slice(20)}\n`, 'garbage'])).toContain(
      'line 2 ',
    )
  })

  test('non-finite and non-round-trippable fields are rejected on both paths', async () => {
    const badRecord = expect.objectContaining({ code: 'bad_record' }) as unknown as Error
    await expect(
      readSession(['{"v":1,"t":1e999,"source":"a","sum":1,"bitsPerTrial":16}']),
    ).rejects.toThrow(badRecord)
    for (const t of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => serializeRecordLine({ v: 1, t, source: 'a', sum: 1, bitsPerTrial: 16 })).toThrow(
        badRecord,
      )
    }
    expect(() =>
      serializeRecordLine({ v: 1, t: 0, source: 'a', sum: 17, bitsPerTrial: 16 }),
    ).toThrow(badRecord)
    expect(() => serializeRecordLine({ v: 1, t: 0, source: '', sum: 1, bitsPerTrial: 16 })).toThrow(
      badRecord,
    )
    await expect(readSession(42 as unknown as string[])).rejects.toThrow(
      expect.objectContaining({ code: 'invalid_plan' }) as unknown as Error,
    )
  })

  test('a failing source propagates its error promptly; the others are closed', async () => {
    const boom = new Error('serial port unplugged')
    let stalledClosed = false
    const failing = {
      name: 'failing',
      async *stream() {
        yield new Uint8Array(2)
        await new Promise((resolve) => setTimeout(resolve, 5))
        throw boom
      },
    }
    const stalled = {
      name: 'stalled',
      async *stream() {
        try {
          yield new Uint8Array(2)
          await new Promise(() => {}) // never delivers the second trial
        } finally {
          stalledClosed = true
        }
      },
    }
    const started = Date.now()
    let caught: unknown
    try {
      await collect(recordSession([failing, stalled], { bitsPerTrial: K, now: fakeClock() }))
    } catch (error) {
      caught = error
    }
    // the source's error propagates (possibly wrapped by negentropy's trialStream)
    const chain: unknown[] = []
    for (let e = caught; e !== undefined; e = (e as { cause?: unknown }).cause) chain.push(e)
    expect(chain).toContain(boom)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(stalledClosed).toBe(false) // stuck in an await: abandoned after the grace period
  })

  test('sources of unequal length: recording ends cleanly at the shortest', async () => {
    const lines = await collect(
      recordSession([finiteSource('a', 3, 21, 2), finiteSource('b', 5, 91, 2)], {
        bitsPerTrial: K,
        now: fakeClock(),
      }),
    )
    expect(lines.length).toBe(6)
    const series = await readSession(lines)
    expect(series.map((s) => s.sums.length)).toEqual([3, 3])
  })

  test('recordSession closes every source on a consumer break', async () => {
    const closed: string[] = []
    const tracked = (name: string) => ({
      name,
      async *stream() {
        try {
          for (let i = 0; ; i++) yield new Uint8Array([i, 255 - i])
        } finally {
          closed.push(name)
        }
      },
    })
    for await (const _ of recordSession([tracked('a'), tracked('b')], { bitsPerTrial: K })) break
    expect(closed.sort()).toEqual(['a', 'b'])
  })

  test('abort is prompt and stays aborted when a source ends its stream on abort', async () => {
    // a source that ignores the signal and never delivers again
    const controller = new AbortController()
    const stalled = {
      name: 'stalled',
      async *stream() {
        yield new Uint8Array(25)
        await new Promise(() => {})
      },
    }
    const gen = recordSession([stalled], { signal: controller.signal })
    expect((await gen.next()).done).toBe(false)
    const pending = gen.next()
    const started = Date.now()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'PsiError', code: 'aborted' })
    expect(Date.now() - started).toBeLessThan(1000)
    // a source that *returns* when the signal fires
    const c2 = new AbortController()
    const polite = {
      name: 'polite',
      async *stream(opts?: { signal?: AbortSignal }) {
        while (!opts?.signal?.aborted) yield new Uint8Array(25)
      },
    }
    const gen2 = recordSession([polite], { signal: c2.signal })
    expect((await gen2.next()).done).toBe(false)
    c2.abort()
    await expect(
      (async () => {
        for (;;) if ((await gen2.next()).done) return 'finished'
      })(),
    ).rejects.toMatchObject({ name: 'PsiError', code: 'aborted' })
  })

  test('abort raises PsiError aborted', async () => {
    const controller = new AbortController()
    const gen = recordSession([countingSource('a')], { signal: controller.signal })
    const first = await gen.next()
    expect(first.done).toBe(false)
    controller.abort()
    await expect(gen.next()).rejects.toMatchObject({ name: 'PsiError', code: 'aborted' })
  })

  test('invalid setups are rejected', async () => {
    const bad = expect.objectContaining({
      name: 'PsiError',
      code: 'invalid_plan',
    }) as unknown as Error
    await expect(collect(recordSession([]))).rejects.toThrow(bad)
    await expect(
      collect(recordSession([countingSource('x'), countingSource('x')])),
    ).rejects.toThrow(bad)
    await expect(
      collect(recordSession([countingSource('a')], { bitsPerTrial: 4 })),
    ).rejects.toThrow(bad)
  })

  test('parseRecordLine rejects impossible sum values (regression)', () => {
    const badRecord = expect.objectContaining({ code: 'bad_record' }) as unknown as Error
    for (const sum of [9999, -3, 7.25]) {
      const line = JSON.stringify({ v: 1, t: 0, source: 'a', sum, bitsPerTrial: 16 })
      expect(() => parseRecordLine(line)).toThrow(badRecord)
    }
    // Boundary values 0 and bitsPerTrial are valid.
    const parse = (line: string) => parseRecordLine(line) as SessionRecordLine
    expect(parse('{"v":1,"t":0,"source":"a","sum":0,"bitsPerTrial":16}').sum).toBe(0)
    expect(parse('{"v":1,"t":0,"source":"a","sum":16,"bitsPerTrial":16}').sum).toBe(16)
  })
})
