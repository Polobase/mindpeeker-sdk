import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordSession, verifyChain } from '@mindpeeker/psi'
import type { MonitorPoint } from '../../src/demo/monitor.js'
import {
  createRecorder,
  pacedRounds,
  type Round,
  readRecording,
  stoufferRounds,
  tapLines,
} from '../../src/demo/recording.js'
import { liveMonitorPoints, replayMonitorPoints } from '../../src/demo.js'
import { VisualizerError } from '../../src/errors.js'
import { fromItems, prngBytes } from '../helpers/streams.js'

const dir = mkdtempSync(join(tmpdir(), 'mindpeeker-viz-recording-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

let fileCounter = 0
const tempFile = (name: string) => join(dir, `${++fileCounter}-${name}`)

async function collect<T>(src: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of src) out.push(item)
  return out
}

async function optionsError(promise: Promise<unknown>): Promise<VisualizerError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(VisualizerError)
    expect((error as VisualizerError).code).toBe('invalid_options')
    return error as VisualizerError
  }
  throw new Error('expected VisualizerError(invalid_options)')
}

/** A byte source serving `bytes` in 256-byte chunks. */
function recorded(name: string, bytes: Uint8Array) {
  return {
    name,
    async *stream() {
      for (let at = 0; at < bytes.length; at += 256) yield bytes.subarray(at, at + 256)
    },
  }
}

/** Record `trials` trials live into a new file; returns the file and the plotted points. */
async function recordLive(trials: number, seed: number) {
  const path = tempFile('session.jsonl')
  const recorder = await createRecorder(path)
  const points = await collect(
    liveMonitorPoints(recorded('esp32', prngBytes(25 * trials, seed)), {
      recorder,
      now: () => 1_700_000_000_000,
    }),
  )
  await recorder.close()
  return { path, points }
}

describe('record → replay', () => {
  test('the recording verifies, and its replay plots exactly the live values', async () => {
    const { path, points } = await recordLive(400, 0xbeef)
    expect(points).toHaveLength(400)
    const text = readFileSync(path, 'utf8')
    const lines = text.split('\n')
    expect(lines).toHaveLength(402) // header + 400 trials + trailing newline
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      v: 2,
      kind: 'session',
      sources: ['esp32'],
    })
    const verification = await verifyChain(text)
    expect(verification.ok).toBe(true)

    const recording = await readRecording(path)
    expect(recording).toMatchObject({
      name: path.split('/').pop(),
      head: verification.head,
      sources: ['esp32'],
      bitsPerTrial: 200,
      trials: 400,
    })
    const replayed = await collect(replayMonitorPoints(recording, { pace: false }))
    expect(replayed).toHaveLength(400)
    replayed.forEach((point, i) => {
      expect(point).toEqual(points[i] as MonitorPoint)
    })
  })

  test('a tampered, reordered or truncated-at-the-front recording is refused', async () => {
    const { path } = await recordLive(20, 7)
    const lines = readFileSync(path, 'utf8').split('\n')

    const tampered = lines.slice()
    tampered[5] = (tampered[5] as string).replace(
      /"sum":(\d+)/,
      (_m, sum) => `"sum":${Number(sum) === 0 ? 1 : Number(sum) - 1}`,
    )
    const tamperedPath = tempFile('tampered.jsonl')
    writeFileSync(tamperedPath, tampered.join('\n'))
    const error = await optionsError(readRecording(tamperedPath))
    expect(error.message).toContain(`refusing to replay ${tamperedPath}`)
    expect(error.message).toContain('hash chain broken at record 7')
    expect(error.message).toContain('prev does not match')

    const swapped = lines.slice()
    ;[swapped[3], swapped[4]] = [swapped[4] as string, swapped[3] as string]
    const swappedPath = tempFile('swapped.jsonl')
    writeFileSync(swappedPath, swapped.join('\n'))
    expect((await optionsError(readRecording(swappedPath))).message).toContain('hash chain broken')

    const headless = tempFile('headless.jsonl')
    writeFileSync(headless, lines.slice(1).join('\n'))
    expect((await optionsError(readRecording(headless))).message).toContain(
      'not a schema-v2 session header',
    )
  })

  test('an unreadable or schema-v1 file is refused', async () => {
    expect((await optionsError(readRecording(join(dir, 'missing.jsonl')))).message).toContain(
      '--replay',
    )
    const v1 = tempFile('v1.jsonl')
    writeFileSync(v1, '{"v":1,"t":0,"source":"a","sum":100,"bitsPerTrial":200}\n')
    expect((await optionsError(readRecording(v1))).message).toContain('refusing to replay')
  })
})

describe('createRecorder / tapLines', () => {
  test('lines are on disk before they are passed on; an existing file is never overwritten', async () => {
    const path = tempFile('tap.jsonl')
    const recorder = await createRecorder(path)
    const seen: string[] = []
    for await (const line of tapLines(fromItems('{"a":1}', '{"b":2}'), recorder)) {
      seen.push(`${line}=${readFileSync(path, 'utf8').split('\n').length - 1}`)
    }
    expect(seen).toEqual(['{"a":1}=1', '{"b":2}=2'])
    expect(readFileSync(path, 'utf8')).toBe('{"a":1}\n{"b":2}\n')
    // tapLines closed it; further writes are refused
    expect((await optionsError(recorder.write('late'))).message).toContain('closed')
    expect((await optionsError(createRecorder(path))).message).toContain('already exists')
    expect(readFileSync(path, 'utf8')).toBe('{"a":1}\n{"b":2}\n')
    await optionsError(createRecorder(join(dir, 'no-such-dir', 'x.jsonl')))
  })
})

describe('stoufferRounds', () => {
  test('multi-source rounds combine as Σz/√N in header order; a partial round is dropped', async () => {
    const a = prngBytes(25 * 30, 11)
    const b = prngBytes(25 * 30, 12)
    const lines = await collect(
      recordSession([recorded('a', a), recorded('b', b)], { chain: true, now: () => 5 }),
    )
    expect(lines).toHaveLength(61)
    const rounds = await collect(stoufferRounds(lines.slice(0, -1))) // last round incomplete
    expect(rounds).toHaveLength(29)
    rounds.forEach((round, i) => {
      const sa = JSON.parse(lines[1 + 2 * i] as string).sum as number
      const sb = JSON.parse(lines[2 + 2 * i] as string).sum as number
      const za = (sa - 100) / Math.sqrt(50)
      const zb = (sb - 100) / Math.sqrt(50)
      expect(round).toEqual({ round: i, z: (za + zb) / Math.SQRT2, at: 5 })
    })

    const outOfOrder = [lines[0] as string, lines[2] as string, lines[1] as string]
    const error = await optionsError(collect(stoufferRounds(outOfOrder, 'swap.jsonl')))
    expect(error.message).toContain('swap.jsonl: line 2 has source b, expected a')
    await optionsError(collect(stoufferRounds(['{"v":2'], 'broken.jsonl')))
  })
})

describe('pacedRounds', () => {
  const rounds = (ats: number[]): AsyncIterable<Round> =>
    fromItems(...ats.map((at, round) => ({ round, z: 0, at })))

  test('waits the recorded gaps, clamped, and never negative', async () => {
    const started = performance.now()
    const out = await collect(pacedRounds(rounds([0, 40, 20, 100_000]), { maxGapMs: 60 }))
    const elapsed = performance.now() - started
    expect(out.map((r) => r.round)).toEqual([0, 1, 2, 3])
    expect(elapsed).toBeGreaterThanOrEqual(95) // 40 + 0 + 60 (timers may fire ~1 ms early)
    expect(elapsed).toBeLessThan(1500)
  })

  test('an abort ends the replay during a wait', async () => {
    const controller = new AbortController()
    const out: number[] = []
    const started = performance.now()
    setTimeout(() => controller.abort(), 30)
    for await (const round of pacedRounds(rounds([0, 5_000, 10_000]), {
      signal: controller.signal,
      maxGapMs: 10_000,
    })) {
      out.push(round.round)
    }
    expect(out).toEqual([0])
    expect(performance.now() - started).toBeLessThan(1000)
  })
})
