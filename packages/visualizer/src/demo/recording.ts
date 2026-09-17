/**
 * Hash-chained trial recordings for the demo: live trials become psi JSONL
 * schema-v2 lines (`recordSession(…, { chain: true })`), optionally persisted
 * with `--record`, and both the live and the `--replay` path turn those lines
 * into the same per-round Stouffer Z series — so a replay plots exactly what
 * the live session plotted. BUN/NODE-ONLY (`node:fs`, `node:path`).
 */
import { open, readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  parseRecordLine,
  recordSession,
  type SessionHeaderLine,
  type TrialSource,
  verifyChain,
} from '@mindpeeker/psi'
import { VisualizerError } from '../errors.js'
import { describeError } from '../internal/describe-error.js'
import { abortableSleep } from '../internal/iterate.js'

/** GCP convention: a trial is the sum of 200 bits, Binomial(200, ½) under H0. */
export const BITS_PER_TRIAL = 200
/** Bytes per trial pull (200 bits = 25 bytes). */
const TRIAL_CHUNK_BYTES = 25
/** Longest pause replayed between two recorded rounds. */
export const MAX_REPLAY_GAP_MS = 1000

/** One lock-step round of a recording: its Stouffer Z over every source. */
export interface Round {
  /** 0-based round index. */
  readonly round: number
  /** $Z = \sum_i z_i / \sqrt{N}$ with $z_i = (S_i - k/2)/\sqrt{k/4}$. */
  readonly z: number
  /** Recorded epoch-ms timestamp of the round's last trial. */
  readonly at: number
}

/**
 * Live trials of one byte source as hash-chained schema-v2 lines: the session
 * header, then one trial line per 200 bits (`recordSession` with
 * `chain: true`). `now` stamps the trials (default `Date.now`).
 */
export function liveTrialLines(
  source: TrialSource,
  opts: { readonly signal?: AbortSignal; readonly now?: () => number } = {},
): AsyncGenerator<string> {
  return recordSession([source], {
    bitsPerTrial: BITS_PER_TRIAL,
    chunkBytes: TRIAL_CHUNK_BYTES,
    chain: true,
    ...(opts.signal && { signal: opts.signal }),
    ...(opts.now && { now: opts.now }),
  })
}

function recordingError(where: string, message: string, cause?: unknown): VisualizerError {
  return new VisualizerError('invalid_options', `${where}: ${message}`, {
    ...(cause !== undefined && { cause }),
  })
}

/**
 * Group schema-v2 lines into lock-step rounds and yield each complete round's
 * Stouffer Z. The first non-blank line must be the session header; each round
 * is one trial line per declared source, in header order (the order
 * `recordSession` writes). A trailing partial round is ignored. Structure is
 * checked here; hash links are `verifyChain`'s job.
 *
 * @throws {VisualizerError} `invalid_options` naming `label` and the line for
 *   a line that is not a valid record, a missing header, or a round out of
 *   header order.
 */
export async function* stoufferRounds(
  lines: AsyncIterable<string> | Iterable<string>,
  label = 'recording',
): AsyncGenerator<Round> {
  let header: SessionHeaderLine | undefined
  let lineNo = 0
  let round = 0
  let slot = 0
  let sum = 0
  for await (const text of lines) {
    lineNo++
    if (text.trim() === '') continue
    let record: ReturnType<typeof parseRecordLine>
    try {
      record = parseRecordLine(text, lineNo)
    } catch (cause) {
      throw recordingError(label, describeError(cause), cause)
    }
    if (header === undefined) {
      if (record.v !== 2 || !('kind' in record)) {
        throw recordingError(label, `line ${lineNo} is not a schema-v2 session header`)
      }
      header = record
      continue
    }
    if (record.v !== 2 || 'kind' in record) {
      throw recordingError(label, `line ${lineNo} is not a schema-v2 trial line`)
    }
    const expected = header.sources[slot] as string
    if (record.source !== expected) {
      throw recordingError(
        label,
        `line ${lineNo} has source ${record.source}, expected ${expected} (rounds follow the header's source order)`,
      )
    }
    const k = record.bitsPerTrial
    sum += (record.sum - k / 2) / Math.sqrt(k / 4)
    slot++
    if (slot === header.sources.length) {
      yield { round, z: sum / Math.sqrt(slot), at: record.t }
      round++
      slot = 0
      sum = 0
    }
  }
}

/**
 * Pace recorded rounds by their timestamps: before each round after the
 * first, wait its recorded gap (clamped to $[0, $ `maxGapMs` $]$). Values are
 * untouched — pacing only decides *when* they are plotted. Abort ends the
 * stream.
 */
export async function* pacedRounds(
  rounds: AsyncIterable<Round>,
  opts: { readonly signal?: AbortSignal; readonly maxGapMs?: number } = {},
): AsyncGenerator<Round> {
  const maxGapMs = opts.maxGapMs ?? MAX_REPLAY_GAP_MS
  let previous: number | undefined
  for await (const round of rounds) {
    if (opts.signal?.aborted) return
    if (previous !== undefined) {
      const gap = Math.min(maxGapMs, Math.max(0, round.at - previous))
      if (gap > 0) await abortableSleep(gap, opts.signal)
      if (opts.signal?.aborted) return
    }
    previous = round.at
    yield round
  }
}

/** Z values of a round stream. */
export async function* roundZs(rounds: AsyncIterable<Round>): AsyncGenerator<number> {
  for await (const round of rounds) yield round.z
}

/** An append-only JSONL file opened for one recording. */
export interface Recorder {
  readonly path: string
  /** Append one line (a newline is added); writes are sequential. */
  write(line: string): Promise<void>
  /** Flush pending writes and close the file; idempotent. */
  close(): Promise<void>
}

/**
 * Create `path` for a new recording. Refuses to overwrite: an existing file
 * is evidence, not scratch space.
 *
 * @throws {VisualizerError} `invalid_options` when the file exists or cannot
 *   be created.
 */
export async function createRecorder(path: string): Promise<Recorder> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(path, 'wx')
  } catch (cause) {
    const exists = (cause as { code?: unknown } | null)?.code === 'EEXIST'
    throw recordingError(
      `--record ${path}`,
      exists ? 'the file already exists (recordings are never overwritten)' : describeError(cause),
      cause,
    )
  }
  let pending: Promise<void> = Promise.resolve()
  let closing: Promise<void> | undefined
  return Object.freeze({
    path,
    write(line: string) {
      if (closing !== undefined)
        return Promise.reject(recordingError(`--record ${path}`, 'recorder is closed'))
      pending = pending.then(async () => {
        await handle.write(`${line}\n`)
      })
      return pending
    },
    close() {
      closing ??= pending.then(noop, noop).then(() => handle.close())
      return closing
    },
  })
}

function noop(): void {}

/**
 * Persist every line before passing it on, so nothing is plotted that is not
 * on disk. The recorder is closed when the stream ends, fails or is closed.
 */
export async function* tapLines(
  lines: AsyncIterable<string>,
  recorder: Recorder,
): AsyncGenerator<string> {
  try {
    for await (const line of lines) {
      try {
        await recorder.write(line)
      } catch (cause) {
        throw recordingError(`--record ${recorder.path}`, 'writing failed', cause)
      }
      yield line
    }
  } finally {
    await recorder.close()
  }
}

/** A recording whose hash chain verified end to end. */
export interface VerifiedRecording {
  readonly path: string
  readonly name: string
  /** The file's physical lines (blank lines included). */
  readonly lines: readonly string[]
  /** SHA-256 of the last line: the value to compare with a published head. */
  readonly head: string
  readonly sources: readonly string[]
  readonly bitsPerTrial: number
  /** Trial lines (all sources). */
  readonly trials: number
}

/**
 * Read a `--replay` file into memory once and verify that copy's hash chain
 * (psi `verifyChain`) before anything is plotted — the replay then uses the
 * same copy, so the file cannot change between verification and replay.
 * Memory grows with the recording (about 150 bytes per demo trial line).
 *
 * @throws {VisualizerError} `invalid_options` when the file cannot be read,
 *   or — refusing the replay — when the chain is broken, naming the first
 *   failing record and why.
 */
export async function readRecording(path: string): Promise<VerifiedRecording> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (cause) {
    throw recordingError(`--replay ${path}`, describeError(cause), cause)
  }
  const verification = await verifyChain(text)
  if (!verification.ok || verification.head === undefined) {
    throw recordingError(
      `refusing to replay ${path}`,
      `hash chain broken at record ${(verification.brokenAt ?? 0) + 1}: ${verification.reason ?? 'unknown reason'}`,
    )
  }
  // keep blank lines so later messages name physical line numbers
  const lines = text.split(/\r?\n/)
  const records = lines.filter((line) => line.trim() !== '')
  const header = parseRecordLine(records[0] as string) as SessionHeaderLine
  return Object.freeze({
    path,
    name: basename(path),
    lines: Object.freeze(lines),
    head: verification.head,
    sources: header.sources,
    bitsPerTrial: header.bitsPerTrial,
    trials: records.length - 1,
  })
}
