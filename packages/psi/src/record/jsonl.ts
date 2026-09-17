import { DEFAULT_BITS_PER_TRIAL, NegentropyError, trialStream } from '@mindpeeker/negentropy'
import { PsiError } from '../errors.js'
import { closeIterator, nextOrAbort } from '../internal/abort.js'
import { sha256Hex } from '../internal/digest.js'
import { textLines } from '../internal/text-lines.js'
import type { Trial, TrialSeries, TrialSource } from '../types.js'
import {
  isHex64,
  parseRecordLine,
  type RecordTags,
  type SessionHeaderLine,
  serializeRecordLine,
  ZERO_HASH,
} from './line.js'

export type { ChainVerification, VerifyChainOptions } from './chain.js'
export { verifyChain } from './chain.js'
export type {
  RecordTags,
  SessionHeaderLine,
  SessionLine,
  SessionRecordLine,
  SessionTrialLine,
} from './line.js'
export { parseRecordLine, serializeRecordLine, ZERO_HASH } from './line.js'

/** Options for {@link recordSession}. */
export interface RecordSessionOptions {
  /** Bits per trial. Default 200 (the GCP convention). */
  bitsPerTrial?: number
  signal?: AbortSignal
  /** Desired chunk size passed through to each source's stream. */
  chunkBytes?: number
  /** Clock override for deterministic tests. */
  now?: () => number
  /**
   * Emit schema v2: a session header, then hash-chained trial lines.
   * `{ registration }` binds the chain to a registration hash (lower-case hex
   * SHA-256, e.g. `registerTripolar(plan).hash`), which becomes the genesis.
   * Default `false`: schema-v1 lines, byte-identical to 0.1.x.
   */
  chain?: boolean | { readonly registration?: string }
  /**
   * Design tags for v2 trial lines (requires `chain`): fixed tags, or a
   * function of the 0-based round and source name.
   */
  tags?: RecordTags | ((round: number, source: string) => RecordTags | undefined)
}

function resolveChain(opts: RecordSessionOptions): { registration?: string } | undefined {
  const chain = opts.chain ?? false
  if (chain === false) {
    if (opts.tags !== undefined) {
      throw new PsiError('invalid_plan', 'tags need schema v2: pass chain: true')
    }
    return undefined
  }
  if (chain === true) return {}
  if (chain === null || typeof chain !== 'object') {
    throw new PsiError('invalid_plan', 'chain must be a boolean or { registration }')
  }
  if (chain.registration !== undefined && !isHex64(chain.registration)) {
    throw new PsiError('invalid_plan', 'chain.registration must be a lower-case hex SHA-256')
  }
  return chain.registration !== undefined ? { registration: chain.registration } : {}
}

/**
 * Record a live multi-source session as JSONL lines, sink-agnostic — the
 * caller persists them (file, socket, memory). Sources advance in lock-step
 * rounds: each round awaits one trial from *every* source, then yields one
 * line per source in `sources` order, so the recording is step-aligned by
 * construction. Recording ends cleanly when the first source ends (all series
 * stay equal-length).
 *
 * **Schema v1** (default): `{"v":1,"t":…,"source":…,"sum":…,"bitsPerTrial":…}`.
 *
 * **Schema v2** (`chain`): first a header
 * `{"v":2,"kind":"session","sources":[…],"bitsPerTrial":…,"registration"?:…,"genesis":…}`,
 * then trial lines `{"v":2,"i":…,"prev":…,"t":…,"source":…,"sum":…,"bitsPerTrial":…}`
 * (plus `arm`/`segment`/`run` tags) where `prev` is the SHA-256 of the
 * previous line's exact text. Anyone holding the lines can check them with
 * `verifyChain`; publishing the final head commits to the whole recording.
 *
 * Abort is prompt: pulls race the signal, and a source that reacts to the
 * abort by ending its stream still raises `PsiError('aborted')`. Every source
 * stream is closed on completion, error, abort, or a consumer `break`.
 *
 * Determinism: the same source bytes and the same `now` produce
 * byte-identical lines, so a replay through {@link readSession} reproduces a
 * live analysis exactly.
 *
 * @throws {PsiError} `invalid_plan` (no sources, duplicate names, bad
 *   `bitsPerTrial`, `chain`, or `tags`), `bad_record` (a tag that fails the
 *   schema), `aborted`. Other source failures propagate.
 */
export async function* recordSession(
  sources: readonly TrialSource[],
  opts: RecordSessionOptions = {},
): AsyncGenerator<string> {
  if (!Array.isArray(sources as unknown) || sources.length === 0) {
    throw new PsiError('invalid_plan', 'recordSession needs at least one source')
  }
  const names = sources.map((s) => s?.name)
  if (names.some((name) => typeof name !== 'string' || name.length === 0)) {
    throw new PsiError('invalid_plan', 'every source needs a non-empty name')
  }
  if (new Set(names).size !== sources.length) {
    throw new PsiError('invalid_plan', 'source names must be unique')
  }
  const bitsPerTrial = opts.bitsPerTrial ?? DEFAULT_BITS_PER_TRIAL
  if (!Number.isInteger(bitsPerTrial) || bitsPerTrial < 8) {
    throw new PsiError('invalid_plan', `bitsPerTrial must be an integer ≥ 8, got ${bitsPerTrial}`)
  }
  const chain = resolveChain(opts)
  const tags = opts.tags
  if (
    tags !== undefined &&
    typeof tags !== 'function' &&
    (tags === null || typeof tags !== 'object')
  ) {
    throw new PsiError('invalid_plan', 'tags must be an object or a function')
  }
  const signal = opts.signal
  const onAbort = () => new PsiError('aborted', 'session recording aborted')
  const now = opts.now ?? (() => Date.now())
  let prev = ''
  let index = 0
  if (chain) {
    const header: SessionHeaderLine = {
      v: 2,
      kind: 'session',
      sources: names as string[],
      bitsPerTrial,
      ...(chain.registration !== undefined && { registration: chain.registration }),
      genesis: chain.registration ?? ZERO_HASH,
    }
    const line = serializeRecordLine(header)
    prev = await sha256Hex(line)
    yield line
  }
  const iterators = sources.map((source) =>
    trialStream(source, {
      bitsPerTrial,
      ...(signal && { signal }),
      ...(opts.chunkBytes !== undefined && { chunkBytes: opts.chunkBytes }),
      ...(opts.now && { now: opts.now }),
    }),
  )
  let failed = false
  try {
    for (let round = 0; ; round++) {
      const results = await Promise.all(
        iterators.map((iterator) => nextOrAbort(iterator, signal, onAbort)),
      )
      if (results.some((result) => result.done)) {
        if (signal?.aborted) throw onAbort()
        return
      }
      for (let s = 0; s < sources.length; s++) {
        const trial = (results[s] as IteratorResult<Trial>).value as Trial
        const source = names[s] as string
        const t = trial.at ?? now()
        if (!chain) {
          yield serializeRecordLine({ v: 1, t, source, sum: trial.sum, bitsPerTrial })
          continue
        }
        const tagSet = typeof tags === 'function' ? tags(round, source) : tags
        const line = serializeRecordLine({
          v: 2,
          i: index,
          prev,
          t,
          source,
          sum: trial.sum,
          bitsPerTrial,
          ...(tagSet?.arm !== undefined && { arm: tagSet.arm }),
          ...(tagSet?.segment !== undefined && { segment: tagSet.segment }),
          ...(tagSet?.run !== undefined && { run: tagSet.run }),
        })
        prev = await sha256Hex(line)
        index++
        yield line
      }
    }
  } catch (error) {
    // an error or abort can leave other sources' pulls pending: cap their cleanup
    failed = true
    if (error instanceof PsiError) throw error
    if ((error instanceof NegentropyError && error.code === 'aborted') || signal?.aborted) {
      throw new PsiError('aborted', 'session recording aborted', { cause: error })
    }
    throw error
  } finally {
    await Promise.all(
      iterators.map((iterator) => closeIterator(iterator, failed || signal?.aborted === true)),
    )
  }
}

interface SeriesAccumulator {
  bitsPerTrial: number
  sums: number[]
  timestamps: number[]
}

/**
 * Read a recorded session back into `TrialSeries[]`. Accepts schema v1 and v2:
 *
 * - **v1** — series grouped by source in first-seen order; a source changing
 *   `bitsPerTrial` is a `bad_record`.
 * - **v2** — the first line must be the session header; series follow the
 *   header's source order (a declared source without trials yields an empty
 *   series); trial lines must count `i` from 0 without gaps and use a
 *   declared source and the header's `bitsPerTrial`. Hash links are *not*
 *   checked here — run `verifyChain` for that. Tags are validated but not
 *   returned; parse lines with `parseRecordLine` to read them.
 *
 * Mixing v1 and v2 lines is a `bad_record`. Input may be a whole file as one
 * string, an iterable of lines with or without terminators, or byte-stream
 * text chunks split anywhere (a segment without a newline is carried into
 * the next chunk unless it is already a complete JSON object). Blank lines are
 * skipped; reported line numbers are the file's physical line numbers.
 *
 * Replay is deterministic: `analyzeEvent(await readSession(lines), window)`
 * reproduces the analysis of the live data that produced the lines, exactly.
 *
 * @throws {PsiError} `bad_record` naming the offending line; `invalid_plan`
 *   for an input that is not a string or iterable of strings.
 */
export async function readSession(
  lines: string | Iterable<string> | AsyncIterable<string>,
): Promise<TrialSeries[]> {
  const bySource = new Map<string, SeriesAccumulator>()
  let schema: 1 | 2 | undefined
  let header: SessionHeaderLine | undefined
  let nextIndex = 0
  for await (const { text, lineNo } of textLines(lines, 'json-lines')) {
    if (text.trim() === '') continue
    const record = parseRecordLine(text, lineNo)
    const where = `line ${lineNo}`
    if (schema === undefined) {
      schema = record.v
      if (record.v === 2) {
        if (!('kind' in record)) {
          throw new PsiError(
            'bad_record',
            `${where}: a schema-v2 recording must start with its session header`,
          )
        }
        header = record
        for (const source of record.sources) {
          bySource.set(source, { bitsPerTrial: record.bitsPerTrial, sums: [], timestamps: [] })
        }
        continue
      }
    } else if (record.v !== schema) {
      throw new PsiError(
        'bad_record',
        `${where} mixes schema v${record.v} into a v${schema} recording`,
      )
    }
    if ('kind' in record) {
      throw new PsiError('bad_record', `${where} is a second session header`)
    }
    if (record.v === 2) {
      if (record.i !== nextIndex) {
        throw new PsiError('bad_record', `${where} has i ${record.i}, expected ${nextIndex}`, {
          source: record.source,
        })
      }
      nextIndex++
    }
    const existing = bySource.get(record.source)
    if (existing === undefined) {
      if (header !== undefined) {
        throw new PsiError(
          'bad_record',
          `${where}: source ${record.source} is not declared in the header`,
          {
            source: record.source,
          },
        )
      }
      bySource.set(record.source, {
        bitsPerTrial: record.bitsPerTrial,
        sums: [record.sum],
        timestamps: [record.t],
      })
      continue
    }
    if (existing.bitsPerTrial !== record.bitsPerTrial) {
      throw new PsiError(
        'bad_record',
        `${where}: ${record.source} changes bitsPerTrial from ${existing.bitsPerTrial} to ${record.bitsPerTrial}`,
        { source: record.source },
      )
    }
    existing.sums.push(record.sum)
    existing.timestamps.push(record.t)
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
