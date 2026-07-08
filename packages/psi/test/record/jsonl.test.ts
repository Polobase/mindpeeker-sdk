import { describe, expect, test } from 'bun:test'
import { trialsFromBytes } from '@mindpeeker/negentropy'
import type { PsiError } from '../../src/errors.js'
import { analyzeEvent } from '../../src/gcp/event.js'
import {
  parseRecordLine,
  readSession,
  recordSession,
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
      const parsed = parseRecordLine(lines[i] as string)
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
    expect(readSession(['not json'])).rejects.toThrow(bad)
    expect(readSession(['{"v":2,"t":0,"source":"a","sum":1,"bitsPerTrial":16}'])).rejects.toThrow(
      bad,
    )
    expect(readSession(['{"v":1,"t":0,"source":"a","sum":1}'])).rejects.toThrow(bad)
    expect(readSession(['{"v":1,"t":0,"source":"a","sum":1,"bitsPerTrial":4}'])).rejects.toThrow(
      bad,
    )
    expect(readSession(['{"v":1,"t":0,"source":"","sum":1,"bitsPerTrial":16}'])).rejects.toThrow(
      bad,
    )
    expect(readSession(['[1,2,3]'])).rejects.toThrow(bad)
    // per-source bitsPerTrial must not change mid-recording
    expect(
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

  test('abort raises PsiError aborted', async () => {
    const controller = new AbortController()
    const gen = recordSession([countingSource('a')], { signal: controller.signal })
    const first = await gen.next()
    expect(first.done).toBe(false)
    controller.abort()
    expect(gen.next()).rejects.toMatchObject({ name: 'PsiError', code: 'aborted' })
  })

  test('invalid setups are rejected', async () => {
    const bad = expect.objectContaining({
      name: 'PsiError',
      code: 'invalid_plan',
    }) as unknown as Error
    expect(collect(recordSession([]))).rejects.toThrow(bad)
    expect(collect(recordSession([countingSource('x'), countingSource('x')]))).rejects.toThrow(bad)
    expect(collect(recordSession([countingSource('a')], { bitsPerTrial: 4 }))).rejects.toThrow(bad)
  })

  test('parseRecordLine rejects impossible sum values (regression)', () => {
    const badRecord = expect.objectContaining({ code: 'bad_record' }) as unknown as Error
    for (const sum of [9999, -3, 7.25]) {
      const line = JSON.stringify({ v: 1, t: 0, source: 'a', sum, bitsPerTrial: 16 })
      expect(() => parseRecordLine(line)).toThrow(badRecord)
    }
    // Boundary values 0 and bitsPerTrial are valid.
    expect(parseRecordLine('{"v":1,"t":0,"source":"a","sum":0,"bitsPerTrial":16}').sum).toBe(0)
    expect(parseRecordLine('{"v":1,"t":0,"source":"a","sum":16,"bitsPerTrial":16}').sum).toBe(16)
  })
})
