import { DEFAULT_BITS_PER_TRIAL, NegentropyError, trialStream } from '@mindpeeker/negentropy'
import { PsiError } from '../errors.js'
import type { Trial, TrialSeries, TrialSource } from '../types.js'

/**
 * One recorded trial — the JSONL session-record schema, version 1. Keys are
 * serialized in exactly this order so records round-trip byte-exact:
 * `{"v":1,"t":…,"source":…,"sum":…,"bitsPerTrial":…}`.
 */
export interface SessionRecordLine {
  /** Schema version. Always 1. */
  readonly v: 1
  /** Epoch ms of trial completion. */
  readonly t: number
  /** Source name the trial came from. */
  readonly source: string
  /** One-bits among the trial's `bitsPerTrial` bits. */
  readonly sum: number
  /** Bits summed per trial. */
  readonly bitsPerTrial: number
}

/**
 * Serialize one record to its canonical JSONL line (no trailing newline).
 * Deterministic: fixed key order, `JSON.stringify` number/string encoding —
 * `serializeRecordLine(parseRecordLine(line)) === line` for canonical lines.
 */
export function serializeRecordLine(line: SessionRecordLine): string {
  return JSON.stringify({
    v: line.v,
    t: line.t,
    source: line.source,
    sum: line.sum,
    bitsPerTrial: line.bitsPerTrial,
  })
}

/**
 * Parse and validate one JSONL line into a frozen {@link SessionRecordLine}.
 * Any malformed line — bad JSON, wrong version, missing or ill-typed fields,
 * `bitsPerTrial` < 8 — raises `PsiError('bad_record')` naming the line.
 */
export function parseRecordLine(raw: string, lineNo?: number): SessionRecordLine {
  const where = lineNo !== undefined ? `line ${lineNo}` : 'record'
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new PsiError('bad_record', `${where} is not valid JSON`, { cause })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new PsiError('bad_record', `${where} is not a JSON object`)
  }
  const record = parsed as Record<string, unknown>
  if (record.v !== 1) {
    throw new PsiError('bad_record', `${where} has unsupported version ${String(record.v)}`)
  }
  const { t, source, sum, bitsPerTrial } = record
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    throw new PsiError('bad_record', `${where} has invalid timestamp ${String(t)}`)
  }
  if (typeof source !== 'string' || source.length === 0) {
    throw new PsiError('bad_record', `${where} has invalid source ${String(source)}`)
  }
  if (typeof bitsPerTrial !== 'number' || !Number.isInteger(bitsPerTrial) || bitsPerTrial < 8) {
    throw new PsiError('bad_record', `${where} has invalid bitsPerTrial ${String(bitsPerTrial)}`, {
      source,
    })
  }
  // `sum` is the one-bits count among `bitsPerTrial` bits, so it must be an
  // integer in [0, bitsPerTrial]. Values outside that range are impossible
  // under the schema; accepting them lets a single corrupted line fabricate
  // astronomically significant analyses instead of raising bad_record.
  if (typeof sum !== 'number' || !Number.isInteger(sum) || sum < 0 || sum > bitsPerTrial) {
    throw new PsiError(
      'bad_record',
      `${where} has invalid sum ${String(sum)} (must be an integer in [0, ${bitsPerTrial}])`,
      { source },
    )
  }
  return Object.freeze({ v: 1, t, source, sum, bitsPerTrial })
}

/** Options for {@link recordSession}. */
export interface RecordSessionOptions {
  /** Bits per trial. Default 200 (the GCP convention). */
  bitsPerTrial?: number
  signal?: AbortSignal
  /** Desired chunk size passed through to each source's stream. */
  chunkBytes?: number
  /** Clock override for deterministic tests. */
  now?: () => number
}

/**
 * Record a live multi-source session as JSONL lines, sink-agnostic — the
 * caller persists them (file, socket, memory). Sources advance in lock-step
 * rounds: each round awaits one trial from *every* source, then yields one
 * line per source in `sources` order, so the recording is step-aligned by
 * construction — exactly what `analyzeEvent` requires. Recording ends
 * cleanly when the first source ends (all series stay equal-length); a
 * fired `signal` raises `PsiError('aborted')`.
 *
 * Determinism: the same source bytes and the same `now` produce
 * byte-identical lines, so a replay through {@link readSession} +
 * `analyzeEvent` reproduces a live analysis exactly.
 */
export async function* recordSession(
  sources: readonly TrialSource[],
  opts: RecordSessionOptions = {},
): AsyncGenerator<string> {
  if (sources.length === 0) {
    throw new PsiError('invalid_plan', 'recordSession needs at least one source')
  }
  if (new Set(sources.map((s) => s.name)).size !== sources.length) {
    throw new PsiError('invalid_plan', 'source names must be unique')
  }
  const bitsPerTrial = opts.bitsPerTrial ?? DEFAULT_BITS_PER_TRIAL
  if (!Number.isInteger(bitsPerTrial) || bitsPerTrial < 8) {
    throw new PsiError('invalid_plan', `bitsPerTrial must be an integer ≥ 8, got ${bitsPerTrial}`)
  }
  const now = opts.now ?? (() => Date.now())
  const iterators = sources.map((source) =>
    trialStream(source, {
      bitsPerTrial,
      ...(opts.signal && { signal: opts.signal }),
      ...(opts.chunkBytes !== undefined && { chunkBytes: opts.chunkBytes }),
      ...(opts.now && { now: opts.now }),
    }),
  )
  try {
    while (true) {
      const round = await Promise.all(iterators.map((iterator) => iterator.next()))
      if (round.some((result) => result.done)) return
      for (let i = 0; i < sources.length; i++) {
        const trial = (round[i] as IteratorResult<Trial>).value as Trial
        yield serializeRecordLine({
          v: 1,
          t: trial.at ?? now(),
          source: (sources[i] as TrialSource).name,
          sum: trial.sum,
          bitsPerTrial,
        })
      }
    }
  } catch (error) {
    if (error instanceof NegentropyError && error.code === 'aborted') {
      throw new PsiError('aborted', 'session recording aborted', { cause: error })
    }
    throw error
  } finally {
    for (const iterator of iterators) void iterator.return(undefined).catch(() => {})
  }
}

interface SeriesAccumulator {
  bitsPerTrial: number
  sums: number[]
  timestamps: number[]
}

/**
 * Read a recorded session back into `TrialSeries[]`, grouped by source in
 * first-seen order. Accepts any sync or async iterable of strings; each
 * yielded string may be a single line or several complete
 * newline-separated lines (so a whole file's contents works as a one-element
 * iterable — but do not feed chunks that split a line mid-record). Blank
 * lines are skipped. A source changing `bitsPerTrial` mid-recording is a
 * `bad_record`.
 *
 * Replay is deterministic: `analyzeEvent(await readSession(lines), window)`
 * reproduces the analysis of the live data that produced the lines, exactly.
 */
export async function readSession(
  lines: Iterable<string> | AsyncIterable<string>,
): Promise<TrialSeries[]> {
  const bySource = new Map<string, SeriesAccumulator>()
  let lineNo = 0
  for await (const chunk of lines) {
    for (const raw of chunk.split(/\r?\n/)) {
      lineNo++
      if (raw.trim() === '') continue
      const record = parseRecordLine(raw, lineNo)
      const existing = bySource.get(record.source)
      if (existing === undefined) {
        bySource.set(record.source, {
          bitsPerTrial: record.bitsPerTrial,
          sums: [record.sum],
          timestamps: [record.t],
        })
      } else {
        if (existing.bitsPerTrial !== record.bitsPerTrial) {
          throw new PsiError(
            'bad_record',
            `line ${lineNo}: ${record.source} changes bitsPerTrial from ${existing.bitsPerTrial} to ${record.bitsPerTrial}`,
            { source: record.source },
          )
        }
        existing.sums.push(record.sum)
        existing.timestamps.push(record.t)
      }
    }
  }
  return [...bySource.entries()].map(([source, acc]) =>
    Object.freeze({
      source,
      bitsPerTrial: acc.bitsPerTrial,
      sums: Float64Array.from(acc.sums),
      timestamps: Float64Array.from(acc.timestamps),
    }),
  )
}
