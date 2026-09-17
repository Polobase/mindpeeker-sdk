import { PsiError } from '../errors.js'
import { textLines } from '../internal/text-lines.js'
import type { TrialSeries } from '../types.js'

/** The protocol description of a basket file (type-10 records). */
export interface BasketProtocol {
  /** Item 1: samples per record. */
  readonly samplesPerRecord: number
  /** Item 2: seconds per record. */
  readonly secondsPerRecord: number
  /** Item 3: records per packet. */
  readonly recordsPerPacket: number
  /** Item 4 ("Trial size"): bits summed per trial — 200 in the GCP network. */
  readonly trialSize: number
}

/** Inclusive range of trial values kept by {@link parseBasketCsv}. */
export interface BasketFilter {
  readonly min: number
  readonly max: number
}

/** The GCP's documented exclusion: "we exclude all trial-values greater than 145 and less than 55". */
export const GCP_BASKET_FILTER: BasketFilter = Object.freeze({ min: 55, max: 145 })

/** Options for {@link parseBasketCsv}. */
export interface ParseBasketOptions {
  /**
   * Keep only trial values in `[min, max]`; excluded values count in
   * `filtered` and are treated as missing. `false` keeps every value. Default:
   * {@link GCP_BASKET_FILTER} for 200-bit trials, no filter otherwise.
   */
  filter?: BasketFilter | false
  /** Only these egg IDs, in this order (each must be a column of the file). Default: every egg, in column order. */
  eggs?: readonly number[]
  /**
   * - `'none'` (default) — each egg's series holds its own kept trials,
   *   timestamped; eggs with gaps have different lengths.
   * - `'complete'` — only seconds at which *every* selected egg has a kept
   *   value, so all series are step-aligned with identical timestamps and feed
   *   `analyzeEvent` and `timeOffsetSurrogates` unchanged.
   */
  align?: 'none' | 'complete'
}

/** A parsed basket file. */
export interface BasketData {
  readonly protocol: BasketProtocol
  /** Type 11 item 1: "Eggs reporting". */
  readonly eggsReporting: number
  /** Type 11 items 2 and 3 as epoch ms (Unix seconds × 1000, no leap seconds). */
  readonly startMs: number
  readonly endMs: number
  /** Type 11 item 4: one type-13 row per second of data. */
  readonly seconds: number
  /** Selected egg IDs, aligned with `series`, `missing`, and `filtered`. */
  readonly eggs: readonly number[]
  /**
   * One series per egg: source `egg-<id>`, `bitsPerTrial` = trial size,
   * `timestamps` = the row's Unix second × 1000.
   */
  readonly series: readonly TrialSeries[]
  /** Per egg: void fields (no sample received for that second). */
  readonly missing: readonly number[]
  /** Per egg: values excluded by the filter. */
  readonly filtered: readonly number[]
  /** The filter applied, or `null`. */
  readonly filter: BasketFilter | null
}

/** Split one CSV record: commas, with `"…"` quoting and `""` escapes. */
function splitCsv(line: string, where: string): string[] {
  if (!line.includes('"')) return line.split(',')
  const fields: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] as string
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') {
      fields.push(field)
      field = ''
    } else field += ch
  }
  if (quoted) throw new PsiError('bad_record', `${where} has an unterminated quoted field`)
  fields.push(field)
  return fields
}

/** Decimal digits only (1–15 of them, so the value is a safe integer), else −1. Hot path: no regex. */
function digitsValue(value: string): number {
  const length = value.length
  if (length === 0 || length > 15) return -1
  let n = 0
  for (let i = 0; i < length; i++) {
    const d = value.charCodeAt(i) - 48
    if (d < 0 || d > 9) return -1
    n = n * 10 + d
  }
  return n
}

function integerField(value: string | undefined, where: string, what: string): number {
  const n = value === undefined ? -1 : digitsValue(value)
  if (n < 0) {
    throw new PsiError(
      'bad_record',
      `${where} ${what} must be a non-negative integer of at most 15 digits, got ${String(value)}`,
    )
  }
  return n
}

/** `yyyy-mm-dd hh:mm:ss` for a Unix second, UTC. */
function civilTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ')
}

function checkCivil(field: string | undefined, unixSeconds: number, where: string): void {
  if (field === undefined || field === '') return
  if (field !== civilTime(unixSeconds)) {
    throw new PsiError(
      'bad_record',
      `${where} civil time ${field} does not match Unix time ${unixSeconds} (${civilTime(unixSeconds)})`,
    )
  }
}

function resolveFilter(
  filter: ParseBasketOptions['filter'],
  trialSize: number,
): BasketFilter | null {
  if (filter === false) return null
  if (filter === undefined) return trialSize === 200 ? GCP_BASKET_FILTER : null
  if (
    filter === null ||
    typeof filter !== 'object' ||
    typeof filter.min !== 'number' ||
    typeof filter.max !== 'number' ||
    !Number.isFinite(filter.min) ||
    !Number.isFinite(filter.max) ||
    filter.min > filter.max
  ) {
    throw new PsiError('invalid_plan', 'filter must be false or { min, max } with finite min ≤ max')
  }
  return Object.freeze({ min: filter.min, max: filter.max })
}

function validateOptions(opts: ParseBasketOptions): void {
  if (opts === null || typeof opts !== 'object') {
    throw new PsiError('invalid_plan', 'parseBasketCsv options must be an object')
  }
  if (opts.align !== undefined && opts.align !== 'none' && opts.align !== 'complete') {
    throw new PsiError(
      'invalid_plan',
      `align must be 'none' or 'complete', got ${String(opts.align)}`,
    )
  }
  if (opts.eggs !== undefined) {
    if (
      !Array.isArray(opts.eggs as unknown) ||
      opts.eggs.some((id) => !Number.isSafeInteger(id) || id < 0) ||
      new Set(opts.eggs).size !== opts.eggs.length
    ) {
      throw new PsiError('invalid_plan', 'eggs must be an array of unique non-negative integer IDs')
    }
  }
  if (opts.filter !== undefined && opts.filter !== false) resolveFilter(opts.filter, 0)
}

interface Header {
  readonly protocol: Partial<Record<keyof BasketProtocol, number>>
  eggsReporting?: number
  start?: number
  end?: number
  seconds?: number
}

const PROTOCOL_ITEMS: Record<number, keyof BasketProtocol> = {
  1: 'samplesPerRecord',
  2: 'secondsPerRecord',
  3: 'recordsPerPacket',
  4: 'trialSize',
}

function headerRecord(fields: string[], header: Header, where: string): void {
  const item = integerField(fields[1], where, 'item')
  if (fields[0] === '10') {
    const key = PROTOCOL_ITEMS[item]
    if (key === undefined) return // undocumented item: ignored for forward compatibility
    if (header.protocol[key] !== undefined) {
      throw new PsiError('bad_record', `${where} repeats type-10 item ${item}`)
    }
    const value = integerField(fields[2], where, key)
    if (value < 1) throw new PsiError('bad_record', `${where} ${key} must be ≥ 1`)
    ;(header.protocol as Record<string, number>)[key] = value
    return
  }
  const slot = ({ 1: 'eggsReporting', 2: 'start', 3: 'end', 4: 'seconds' } as const)[
    item as 1 | 2 | 3 | 4
  ]
  if (slot === undefined) return
  if (header[slot] !== undefined) {
    throw new PsiError('bad_record', `${where} repeats type-11 item ${item}`)
  }
  const value = integerField(fields[2], where, slot)
  if (slot === 'start' || slot === 'end') checkCivil(fields[4], value, where)
  header[slot] = value
}

/**
 * Parse a Global Consciousness Project (GCP 1.0) basket-data CSV file — the
 * format written by John Walker's `basketran` and served as the daily
 * `eggsummary` files (global-mind.org, "Basket Data CSV File Format") — into
 * one {@link TrialSeries} per egg with the file's protocol metadata.
 *
 * Record types, exactly as documented:
 * - **10** — protocol: item 1 samples per record, 2 seconds per record,
 *   3 records per packet, 4 trial size (bits per trial);
 * - **11** — content: item 1 eggs reporting, 2 start and 3 end time (Unix
 *   seconds, optional civil-time fifth field), 4 seconds of data;
 * - **12** — `"gmtime"`, the civil-time label (void when expansion was
 *   suppressed), then the egg IDs of the data columns;
 * - **13** — Unix time, civil time (or void), one trial value per egg column:
 *   the count of one-bits in that second's trial. **A void field is a missing
 *   sample, never 0** (0 is a possible, if improbable, value). There is one
 *   row for *every* second, even when all eggs are missing.
 *
 * Validation is strict: headers before the egg-ID record, which precedes the
 * data; integer fields; civil times that agree with their Unix times; rows
 * contiguous from the start time, one per second; exactly one value per egg
 * column; selected eggs' values in $[0, \text{trial size}]$; and as many rows as "seconds of
 * data" (a truncated download is an error). Undocumented type-10/11 items
 * are ignored.
 *
 * By default GCP's own exclusion of trial values outside 55–145 is applied
 * to 200-bit files (a ±45-bit window, ±6.4σ). Input is a whole file as one
 * string, or text chunks from a stream (e.g. `fetch(url).body` through
 * `DecompressionStream('gzip')` and `TextDecoderStream`) — chunks may split
 * lines anywhere.
 *
 * @throws {PsiError} `bad_record` naming the line for any format violation;
 *   `invalid_plan` for bad options, an unknown egg in `eggs`, or an input
 *   that is not text.
 */
export async function parseBasketCsv(
  input: string | Iterable<string> | AsyncIterable<string>,
  opts: ParseBasketOptions = {},
): Promise<BasketData> {
  validateOptions(opts)
  const align = opts.align ?? 'none'
  const header: Header = { protocol: {} }
  let columns: number[] | undefined
  let selected: number[] = [] // column index per selected egg
  let trialSize = 0
  let filter: BasketFilter | null = null
  let sums: number[][] = []
  let stamps: number[][] = []
  let missing: number[] = []
  let filtered: number[] = []
  let row: number[] = []
  let rows = 0
  for await (const { text, lineNo } of textLines(input, 'text')) {
    if (text.trim() === '') continue
    const where = `line ${lineNo}`
    const fields = splitCsv(text, where)
    const type = fields[0]
    if (type === '13') {
      if (columns === undefined) {
        throw new PsiError(
          'bad_record',
          `${where}: a type-13 data row precedes the type-12 egg IDs`,
        )
      }
      if (fields.length !== 3 + columns.length) {
        throw new PsiError(
          'bad_record',
          `${where} has ${fields.length - 3} egg values for ${columns.length} egg columns`,
        )
      }
      const t = integerField(fields[1], where, 'Unix time')
      if (t !== (header.start as number) + rows) {
        throw new PsiError(
          'bad_record',
          `${where} has Unix time ${t}, expected ${(header.start as number) + rows} (one row per second)`,
        )
      }
      checkCivil(fields[2], t, where)
      const ms = t * 1000
      let complete = true
      for (let e = 0; e < selected.length; e++) {
        const cell = fields[3 + (selected[e] as number)] as string
        if (cell === '') {
          missing[e] = (missing[e] as number) + 1
          complete = false
          continue
        }
        const x = digitsValue(cell)
        if (x < 0 || x > trialSize) {
          throw new PsiError(
            'bad_record',
            `${where} egg ${columns[selected[e] as number]} value ${cell} is not an integer in [0, ${trialSize}]`,
          )
        }
        if (filter !== null && !(x >= filter.min && x <= filter.max)) {
          filtered[e] = (filtered[e] as number) + 1
          complete = false
          continue
        }
        if (align === 'none') {
          ;(sums[e] as number[]).push(x)
          ;(stamps[e] as number[]).push(ms)
        } else row[e] = x
      }
      if (align === 'complete' && complete) {
        for (let e = 0; e < selected.length; e++) {
          ;(sums[e] as number[]).push(row[e] as number)
          ;(stamps[e] as number[]).push(ms)
        }
      }
      rows++
      continue
    }
    if (columns !== undefined) {
      throw new PsiError(
        'bad_record',
        `${where}: record type ${String(type)} after the type-12 egg IDs`,
      )
    }
    if (type === '10' || type === '11') {
      headerRecord(fields, header, where)
      continue
    }
    if (type !== '12') {
      throw new PsiError('bad_record', `${where} has unknown record type ${String(type)}`)
    }
    // type 12: the header block is complete — validate it and set up the columns
    if (fields[1] !== 'gmtime') {
      throw new PsiError('bad_record', `${where}: the type-12 record must start with "gmtime"`)
    }
    const p = header.protocol
    for (const key of Object.values(PROTOCOL_ITEMS)) {
      if (p[key] === undefined)
        throw new PsiError('bad_record', `${where}: type-10 ${key} is missing`)
    }
    for (const key of ['eggsReporting', 'start', 'end', 'seconds'] as const) {
      if (header[key] === undefined)
        throw new PsiError('bad_record', `${where}: type-11 ${key} is missing`)
    }
    if ((header.end as number) - (header.start as number) + 1 !== header.seconds) {
      throw new PsiError(
        'bad_record',
        `${where}: seconds of data ${header.seconds} does not span start ${header.start} to end ${header.end}`,
      )
    }
    trialSize = p.trialSize as number
    if (trialSize < 8) {
      throw new PsiError(
        'bad_record',
        `${where}: trial size ${trialSize} is below the SDK floor of 8 bits`,
      )
    }
    filter = resolveFilter(opts.filter, trialSize)
    const ids = fields.slice(3).map((id) => integerField(id, where, 'egg ID'))
    if (new Set(ids).size !== ids.length) {
      throw new PsiError('bad_record', `${where} lists an egg ID twice`)
    }
    columns = ids
    const wanted = opts.eggs ?? ids
    selected = wanted.map((id) => {
      const column = ids.indexOf(id)
      if (column < 0) throw new PsiError('invalid_plan', `egg ${id} is not a column of this file`)
      return column
    })
    sums = selected.map(() => [])
    stamps = selected.map(() => [])
    missing = selected.map(() => 0)
    filtered = selected.map(() => 0)
    row = selected.map(() => 0)
  }
  if (columns === undefined) {
    throw new PsiError('bad_record', 'the file has no type-12 egg-ID record')
  }
  if (rows !== header.seconds) {
    throw new PsiError(
      'bad_record',
      `the file has ${rows} data rows for ${header.seconds} seconds of data (truncated?)`,
    )
  }
  const eggs = selected.map((column) => columns[column] as number)
  return Object.freeze({
    protocol: Object.freeze({ ...(header.protocol as BasketProtocol) }),
    eggsReporting: header.eggsReporting as number,
    startMs: (header.start as number) * 1000,
    endMs: (header.end as number) * 1000,
    seconds: header.seconds as number,
    eggs: Object.freeze(eggs),
    series: Object.freeze(
      eggs.map((id, e) =>
        Object.freeze({
          source: `egg-${id}`,
          bitsPerTrial: trialSize,
          sums: Float64Array.from(sums[e] as number[]),
          timestamps: Float64Array.from(stamps[e] as number[]),
        }),
      ),
    ),
    missing: Object.freeze(missing),
    filtered: Object.freeze(filtered),
    filter,
  })
}
