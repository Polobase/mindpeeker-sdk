import { describe, expect, test } from 'bun:test'
import {
  parseRecordLine,
  readSession,
  recordSession,
  type SessionTrialLine,
  serializeRecordLine,
  verifyChain,
  ZERO_HASH,
} from '../../src/record/jsonl.js'
import { fakeClock, finiteSource } from '../helpers/trial-sources.js'

const K = 16
const ROUNDS = 6
const REGISTRATION = 'ab'.repeat(32)

async function sha256(text: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  )
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = []
  for await (const line of gen) out.push(line)
  return out
}

function sources() {
  return [finiteSource('a', ROUNDS, 21, 2), finiteSource('b', ROUNDS, 91, 2)]
}

const record = (opts: Parameters<typeof recordSession>[1] = {}) =>
  collect(recordSession(sources(), { bitsPerTrial: K, now: fakeClock(), chain: true, ...opts }))

const badRecord = expect.objectContaining({ code: 'bad_record' }) as unknown as Error
const invalidPlan = expect.objectContaining({ code: 'invalid_plan' }) as unknown as Error

describe('schema v2 recording', () => {
  test('header, then trial lines hash-chained to the previous line', async () => {
    const lines = await record()
    expect(lines.length).toBe(1 + 2 * ROUNDS)
    expect(lines[0]).toBe(
      `{"v":2,"kind":"session","sources":["a","b"],"bitsPerTrial":16,"genesis":"${ZERO_HASH}"}`,
    )
    for (let j = 1; j < lines.length; j++) {
      const trial = parseRecordLine(lines[j] as string) as SessionTrialLine
      expect(trial.v).toBe(2)
      expect(trial.i).toBe(j - 1)
      expect(trial.source).toBe(j % 2 === 1 ? 'a' : 'b')
      expect(trial.prev).toBe(await sha256(lines[j - 1] as string))
      expect(serializeRecordLine(trial)).toBe(lines[j] as string)
    }
    // exact key order of a trial line
    expect(lines[1]).toMatch(
      /^\{"v":2,"i":0,"prev":"[0-9a-f]{64}","t":\d+,"source":"a","sum":\d+,"bitsPerTrial":16\}$/,
    )
  })

  test('v2 replays to exactly the series of the v1 recording of the same sources', async () => {
    const v2 = await readSession(await record())
    const v1 = await readSession(
      await collect(recordSession(sources(), { bitsPerTrial: K, now: fakeClock() })),
    )
    expect(v2).toEqual(v1)
  })

  test('registration binding: genesis is the registration hash', async () => {
    const lines = await record({ chain: { registration: REGISTRATION } })
    expect(lines[0]).toBe(
      `{"v":2,"kind":"session","sources":["a","b"],"bitsPerTrial":16,"registration":"${REGISTRATION}","genesis":"${REGISTRATION}"}`,
    )
    expect((await verifyChain(lines, { registration: REGISTRATION })).ok).toBe(true)
    const other = await verifyChain(lines, { registration: 'cd'.repeat(32) })
    expect(other).toMatchObject({ ok: false, brokenAt: 0 })
    expect((await verifyChain(await record(), { registration: REGISTRATION })).brokenAt).toBe(0)
  })

  test('tags: fixed or per round, validated', async () => {
    const fixed = await record({ tags: { arm: 'control', segment: 'warmup', run: 3 } })
    expect(fixed[1]).toMatch(/,"bitsPerTrial":16,"arm":"control","segment":"warmup","run":3\}$/)
    const perRound = await record({ tags: (round) => (round < 3 ? { run: round } : undefined) })
    const runs = perRound.slice(1).map((l) => (parseRecordLine(l) as SessionTrialLine).run)
    expect(runs).toEqual([
      0,
      0,
      1,
      1,
      2,
      2,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ])
    expect((await verifyChain(perRound)).ok).toBe(true)
    await expect(record({ tags: { arm: 'sham' as 'control' } })).rejects.toThrow(badRecord)
    await expect(collect(recordSession(sources(), { tags: { run: 1 } }))).rejects.toThrow(
      invalidPlan,
    )
    await expect(record({ chain: { registration: 'ABC' } })).rejects.toThrow(invalidPlan)
  })
})

describe('verifyChain', () => {
  test('an intact recording verifies; head is the SHA-256 of the last line', async () => {
    const lines = await record()
    const result = await verifyChain(lines)
    expect(result).toEqual({
      ok: true,
      lines: lines.length,
      head: await sha256(lines.at(-1) as string),
    })
    // any framing of the same text
    const file = `${lines.join('\n')}\n`
    expect(await verifyChain(file)).toEqual(result)
    const chunks: string[] = []
    for (let i = 0; i < file.length; i += 11) chunks.push(file.slice(i, i + 11))
    expect(await verifyChain(chunks)).toEqual(result)
    // truncation keeps the chain valid but changes the head
    const truncated = await verifyChain(lines.slice(0, -1))
    expect(truncated.ok).toBe(true)
    expect(truncated.head).not.toBe(result.head)
  })

  test('edits, deletions, insertions, reorderings, and re-encodings break it at the first bad link', async () => {
    const lines = await record()
    const edit = (j: number, change: Partial<SessionTrialLine>) => {
      const copy = [...lines]
      const trial = parseRecordLine(copy[j] as string) as SessionTrialLine
      copy[j] = serializeRecordLine({ ...trial, ...change })
      return copy
    }
    // an edited sum is self-consistent; the next line's prev exposes it
    expect(await verifyChain(edit(5, { sum: 0 }))).toMatchObject({ ok: false, brokenAt: 6 })
    // editing the last line is only visible against the published head
    const last = lines.length - 1
    const lastEdited = await verifyChain(edit(last, { sum: 1 }))
    expect(lastEdited.ok).toBe(true)
    expect(lastEdited.head).not.toBe((await verifyChain(lines)).head)
    // deletion and reordering break the index sequence
    expect(await verifyChain(lines.filter((_, j) => j !== 4))).toMatchObject({
      ok: false,
      brokenAt: 4,
    })
    const swapped = [...lines]
    ;[swapped[3], swapped[4]] = [swapped[4] as string, swapped[3] as string]
    expect(await verifyChain(swapped)).toMatchObject({ ok: false, brokenAt: 3 })
    // an edited header breaks the first trial's link
    const header = [...lines]
    header[0] = (header[0] as string).replace('["a","b"]', '["a","b","c"]')
    expect(await verifyChain(header)).toMatchObject({ ok: false, brokenAt: 1 })
    // same record, different bytes (whitespace) is rejected as non-canonical
    const spaced = [...lines]
    spaced[2] = (spaced[2] as string).replace('"t":', '"t": ')
    const nonCanonical = await verifyChain(spaced)
    expect(nonCanonical).toMatchObject({ ok: false, brokenAt: 2 })
    expect(nonCanonical.reason).toContain('canonical')
    // undeclared source or foreign bitsPerTrial on a re-linked line
    const relinked = async (change: Partial<SessionTrialLine>) => {
      const copy = lines.slice(0, 3)
      const trial = parseRecordLine(lines[3] as string) as SessionTrialLine
      copy.push(serializeRecordLine({ ...trial, ...change, prev: await sha256(copy[2] as string) }))
      return verifyChain(copy)
    }
    expect(await relinked({})).toMatchObject({ ok: true })
    expect(await relinked({ source: 'z' })).toMatchObject({ ok: false, brokenAt: 3 })
    expect(await relinked({ bitsPerTrial: 32 })).toMatchObject({ ok: false, brokenAt: 3 })
  })

  test('non-v2 input and empty input are reported, not thrown', async () => {
    const v1 = await collect(recordSession(sources(), { bitsPerTrial: K, now: fakeClock() }))
    expect(await verifyChain(v1)).toMatchObject({ ok: false, brokenAt: 0 })
    expect(await verifyChain([])).toMatchObject({ ok: false, lines: 0 })
    expect(await verifyChain(['not json'])).toMatchObject({ ok: false, brokenAt: 0 })
    await expect(verifyChain([], { registration: 'nope' })).rejects.toThrow(invalidPlan)
  })
})

describe('readSession: schema v2 structure', () => {
  test('rejects missing or repeated headers, mixed schemas, index gaps, undeclared sources', async () => {
    const lines = await record()
    await expect(readSession(lines.slice(1))).rejects.toThrow(badRecord)
    await expect(readSession([lines[0] as string, ...lines])).rejects.toThrow(badRecord)
    await expect(
      readSession([...lines, '{"v":1,"t":0,"source":"a","sum":1,"bitsPerTrial":16}']),
    ).rejects.toThrow(badRecord)
    await expect(readSession(lines.filter((_, j) => j !== 3))).rejects.toThrow(badRecord)
    const foreign = parseRecordLine(lines[1] as string) as SessionTrialLine
    await expect(
      readSession([lines[0] as string, serializeRecordLine({ ...foreign, source: 'z' })]),
    ).rejects.toThrow(badRecord)
    await expect(
      readSession([
        lines[0] as string,
        serializeRecordLine({ ...foreign, bitsPerTrial: 32, sum: 1 }),
      ]),
    ).rejects.toThrow(badRecord)
  })

  test('a declared source without trials yields an empty series', async () => {
    const header = `{"v":2,"kind":"session","sources":["a","b"],"bitsPerTrial":16,"genesis":"${ZERO_HASH}"}`
    const series = await readSession([header])
    expect(series.map((s) => [s.source, s.sums.length])).toEqual([
      ['a', 0],
      ['b', 0],
    ])
  })

  test('parseRecordLine enforces the v2 schema', () => {
    const header = (fields: string) => `{"v":2,"kind":"session",${fields}}`
    const ok = header(`"sources":["a"],"bitsPerTrial":16,"genesis":"${ZERO_HASH}"`)
    expect(serializeRecordLine(parseRecordLine(ok))).toBe(ok)
    for (const bad of [
      header(`"sources":[],"bitsPerTrial":16,"genesis":"${ZERO_HASH}"`),
      header(`"sources":["a","a"],"bitsPerTrial":16,"genesis":"${ZERO_HASH}"`),
      header(`"sources":["a"],"bitsPerTrial":4,"genesis":"${ZERO_HASH}"`),
      header(`"sources":["a"],"bitsPerTrial":16,"genesis":"${REGISTRATION}"`), // genesis ≠ zeros
      header(
        `"sources":["a"],"bitsPerTrial":16,"registration":"${REGISTRATION}","genesis":"${ZERO_HASH}"`,
      ),
      header(`"sources":["a"],"bitsPerTrial":16,"genesis":"${ZERO_HASH}","extra":1`),
      '{"v":2,"kind":"other","sources":["a"],"bitsPerTrial":16}',
      `{"v":2,"i":-1,"prev":"${ZERO_HASH}","t":0,"source":"a","sum":1,"bitsPerTrial":16}`,
      `{"v":2,"i":0,"prev":"${REGISTRATION.toUpperCase()}","t":0,"source":"a","sum":1,"bitsPerTrial":16}`,
      `{"v":2,"i":0,"prev":"${ZERO_HASH}","t":1e999,"source":"a","sum":1,"bitsPerTrial":16}`,
      `{"v":2,"i":0,"prev":"${ZERO_HASH}","t":0,"source":"a","sum":1,"bitsPerTrial":16,"run":-2}`,
      `{"v":2,"i":0,"prev":"${ZERO_HASH}","t":0,"source":"a","sum":1,"bitsPerTrial":16,"segment":""}`,
      `{"v":2,"i":0,"prev":"${ZERO_HASH}","t":0,"source":"a","sum":1,"bitsPerTrial":16,"note":"x"}`,
    ]) {
      expect(() => parseRecordLine(bad), bad).toThrow(badRecord)
    }
  })
})
