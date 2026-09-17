import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { GCP_BASKET_FILTER, parseBasketCsv } from '../../src/gcp/basket.js'
import { analyzeEvent } from '../../src/gcp/event.js'
import type { TrialSeries } from '../../src/types.js'

// Synthetic files built from the documented layout (global-mind.org "Basket Data CSV
// File Format") by scripts/fixtures/generate.py; the expected parse there comes from
// Python's csv module.
const dir = join(import.meta.dir, '..', 'fixtures', 'basket')
const civil = readFileSync(join(dir, 'synthetic-civil.csv'), 'utf8')
const brief = readFileSync(join(dir, 'synthetic-brief.csv'), 'utf8')

interface EggExpectation {
  sums: number[]
  timestamps: number[]
  missing?: number
  filtered?: number
}
interface Expectation {
  eggs: number[]
  none: Record<string, EggExpectation>
  complete: Record<string, EggExpectation>
}
const expected = JSON.parse(readFileSync(join(dir, 'synthetic-expected.json'), 'utf8')) as {
  start: number
  seconds: number
  gcpFilter: Expectation
  unfiltered: Expectation
}

const badRecord = expect.objectContaining({
  name: 'PsiError',
  code: 'bad_record',
}) as unknown as Error
const invalidPlan = expect.objectContaining({
  name: 'PsiError',
  code: 'invalid_plan',
}) as unknown as Error

function matches(
  series: readonly TrialSeries[],
  eggs: readonly number[],
  expectation: Record<string, EggExpectation>,
) {
  expect(series.map((s) => s.source)).toEqual(eggs.map((id) => `egg-${id}`))
  eggs.forEach((id, e) => {
    const s = series[e] as TrialSeries
    const want = expectation[String(id)] as EggExpectation
    expect(s.bitsPerTrial).toBe(200)
    expect([...s.sums]).toEqual(want.sums)
    expect([...(s.timestamps ?? [])]).toEqual(want.timestamps)
  })
}

/** Replace line `lineNo` (1-based) of a CSV text. */
function withLine(text: string, lineNo: number, replacement: string | null): string {
  const lines = text.split('\n')
  if (replacement === null) lines.splice(lineNo - 1, 1)
  else lines[lineNo - 1] = replacement
  return lines.join('\n')
}

describe('parseBasketCsv', () => {
  test('reads protocol metadata and per-egg series with the GCP 55..145 exclusion by default', async () => {
    const data = await parseBasketCsv(brief)
    expect(data.protocol).toEqual({
      samplesPerRecord: 10,
      secondsPerRecord: 10,
      recordsPerPacket: 6,
      trialSize: 200,
    })
    expect(data.eggsReporting).toBe(5)
    expect(data.startMs).toBe(expected.start * 1000)
    expect(data.endMs).toBe((expected.start + expected.seconds - 1) * 1000)
    expect(data.seconds).toBe(expected.seconds)
    expect(data.filter).toEqual(GCP_BASKET_FILTER)
    expect(data.eggs).toEqual(expected.gcpFilter.eggs)
    matches(data.series, data.eggs, expected.gcpFilter.none)
    expect(data.missing).toEqual(
      data.eggs.map((id) => expected.gcpFilter.none[String(id)]?.missing as number),
    )
    expect(data.filtered).toEqual(
      data.eggs.map((id) => expected.gcpFilter.none[String(id)]?.filtered as number),
    )
  })

  test('a void field is missing, never zero; zero is a value (excluded only by the filter)', async () => {
    const unfiltered = await parseBasketCsv(brief, { filter: false })
    expect(unfiltered.filter).toBeNull()
    matches(unfiltered.series, unfiltered.eggs, expected.unfiltered.none)
    const egg28 = unfiltered.series[1] as TrialSeries
    expect([...egg28.sums]).toContain(0)
    expect(unfiltered.filtered).toEqual([0, 0, 0, 0, 0])
    // the all-void second (row 15) is counted as missing for every egg
    expect(unfiltered.missing.every((m) => m >= 1)).toBe(true)
    const custom = await parseBasketCsv(brief, { filter: { min: 90, max: 110 } })
    expect(custom.series.every((s) => [...s.sums].every((x) => x >= 90 && x <= 110))).toBe(true)
  })

  test("align: 'complete' keeps only seconds where every selected egg has a kept value", async () => {
    const data = await parseBasketCsv(brief, { align: 'complete' })
    matches(data.series, data.eggs, expected.gcpFilter.complete)
    const lengths = new Set(data.series.map((s) => s.sums.length))
    expect(lengths.size).toBe(1)
    const unfiltered = await parseBasketCsv(brief, { align: 'complete', filter: false })
    matches(unfiltered.series, unfiltered.eggs, expected.unfiltered.complete)
    // step-aligned output feeds analyzeEvent unchanged, identical to hand-built series
    const handBuilt = data.eggs.map((id) => ({
      source: `egg-${id}`,
      bitsPerTrial: 200,
      sums: Float64Array.from(expected.gcpFilter.complete[String(id)]?.sums ?? []),
      timestamps: Float64Array.from(expected.gcpFilter.complete[String(id)]?.timestamps ?? []),
    }))
    const window = { startMs: data.startMs, endMs: data.endMs + 1000 }
    expect(analyzeEvent(data.series, window)).toEqual(analyzeEvent(handBuilt, window))
  })

  test('civil-time expansion and stream chunking do not change the result', async () => {
    const fromBrief = await parseBasketCsv(brief)
    expect(await parseBasketCsv(civil)).toEqual(fromBrief)
    for (const size of [1, 9, 64]) {
      async function* stream() {
        for (let i = 0; i < civil.length; i += size) yield civil.slice(i, i + size)
      }
      expect(await parseBasketCsv(stream())).toEqual(fromBrief)
    }
    expect(await parseBasketCsv(civil.replaceAll('\n', '\r\n'))).toEqual(fromBrief)
  })

  test('egg selection follows the requested order', async () => {
    const data = await parseBasketCsv(brief, { eggs: [1003, 1] })
    expect(data.eggs).toEqual([1003, 1])
    matches(data.series, [1003, 1], expected.gcpFilter.none)
    await expect(parseBasketCsv(brief, { eggs: [42] })).rejects.toThrow(invalidPlan)
  })

  test('format violations are bad_record', async () => {
    const cases: [string, string][] = [
      ['data row before egg IDs', withLine(brief, 9, null)],
      ['missing trial size', withLine(brief, 4, null)],
      ['missing seconds of data', withLine(brief, 8, null)],
      ['unknown record type', withLine(brief, 5, '14,1,5,"Eggs reporting"')],
      ['header after egg IDs', withLine(brief, 11, '10,1,10,"Samples per record"')],
      ['repeated item', withLine(brief, 2, '10,1,10,"Samples per record"')],
      ['duplicate egg ID', withLine(brief, 9, '12,"gmtime",,1,28,37,1000,1')],
      ['type 12 without gmtime', withLine(brief, 9, '12,"time",,1,28,37,1000,1003')],
      ['too few egg values', withLine(brief, 10, '13,905954400,,97,100,103,110')],
      ['too many egg values', withLine(brief, 10, '13,905954400,,97,100,103,110,1,2')],
      ['non-contiguous time', withLine(brief, 11, '13,905954402,,108,97,95,102,101')],
      ['negative value', withLine(brief, 10, '13,905954400,,-97,100,103,110,')],
      ['value above trial size', withLine(brief, 10, '13,905954400,,201,100,103,110,')],
      ['non-integer value', withLine(brief, 10, '13,905954400,,97.5,100,103,110,')],
      [
        'civil time mismatch',
        withLine(civil, 10, '13,905954400,1998-09-16 14:00:01,97,100,103,110,'),
      ],
      [
        'header civil time mismatch',
        withLine(civil, 6, '11,2,905954400,"Start time",1998-09-16 14:00:09'),
      ],
      ['span inconsistent with seconds', withLine(brief, 8, '11,4,21,"Seconds of data"')],
      ['truncated file', brief.split('\n').slice(0, -3).join('\n')],
      ['unterminated quote', withLine(brief, 1, '10,1,10,"Samples per record')],
      ['no egg IDs at all', brief.split('\n').slice(0, 8).join('\n')],
    ]
    for (const [label, text] of cases) {
      await expect(parseBasketCsv(text), label).rejects.toThrow(badRecord)
    }
    // the error names the physical line
    await expect(parseBasketCsv(withLine(brief, 12, '13,905954402,,97,114,x,82,'))).rejects.toThrow(
      /line 12/,
    )
  })

  test('invalid options are invalid_plan before any parsing', async () => {
    await expect(parseBasketCsv(brief, { align: 'rows' as 'none' })).rejects.toThrow(invalidPlan)
    await expect(parseBasketCsv(brief, { eggs: [1, 1] })).rejects.toThrow(invalidPlan)
    await expect(parseBasketCsv(brief, { eggs: [1.5] })).rejects.toThrow(invalidPlan)
    await expect(parseBasketCsv(brief, { filter: { min: 146, max: 54 } })).rejects.toThrow(
      invalidPlan,
    )
    await expect(parseBasketCsv(42 as unknown as string)).rejects.toThrow(invalidPlan)
  })
})
