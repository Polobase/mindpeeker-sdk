import { PsiError } from '../errors.js'

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

/** Optional design tags on a schema-v2 trial line. */
export interface RecordTags {
  /** Experimental or yoked control arm (as `TripolarRun.arm`). */
  readonly arm?: 'experimental' | 'control'
  /** Free-form segment label (session part, condition block, FieldREG segment). Non-empty. */
  readonly segment?: string
  /** Run index within the design. Safe integer ≥ 0. */
  readonly run?: number
}

/**
 * The first line of a schema-v2 recording. Serialized as
 * `{"v":2,"kind":"session","sources":[…],"bitsPerTrial":…,"registration":…,"genesis":…}`
 * (`registration` omitted when absent). `genesis` anchors the hash chain: the
 * registration hash when the session is bound to one, else 64 zeros.
 */
export interface SessionHeaderLine {
  readonly v: 2
  readonly kind: 'session'
  /** Source names in recording order. Non-empty, unique. */
  readonly sources: readonly string[]
  readonly bitsPerTrial: number
  /** Lower-case hex SHA-256 of the registration this session runs under. */
  readonly registration?: string
  /** `registration` if present, otherwise {@link ZERO_HASH}. */
  readonly genesis: string
}

/**
 * One trial of a schema-v2 recording, hash-chained. Serialized as
 * `{"v":2,"i":…,"prev":…,"t":…,"source":…,"sum":…,"bitsPerTrial":…,"arm":…,"segment":…,"run":…}`
 * (tags omitted when absent). `i` counts trial lines from 0; `prev` is the
 * lower-case hex SHA-256 of the UTF-8 bytes of the previous line exactly as
 * serialized — the header for `i = 0`.
 */
export interface SessionTrialLine extends RecordTags {
  readonly v: 2
  readonly i: number
  readonly prev: string
  readonly t: number
  readonly source: string
  readonly sum: number
  readonly bitsPerTrial: number
}

/** Any line of a session recording: v1 trial, v2 header, or v2 trial. Headers carry `kind`. */
export type SessionLine = SessionRecordLine | SessionHeaderLine | SessionTrialLine

/** The chain genesis of a session not bound to a registration: 64 zero hex digits. */
export const ZERO_HASH = '0'.repeat(64)

const HEX64 = /^[0-9a-f]{64}$/
const HEADER_KEYS = new Set(['v', 'kind', 'sources', 'bitsPerTrial', 'registration', 'genesis'])
const TRIAL_V2_KEYS = new Set([
  'v',
  'i',
  'prev',
  't',
  'source',
  'sum',
  'bitsPerTrial',
  'arm',
  'segment',
  'run',
])

function fail(where: string, message: string, source?: string): never {
  throw new PsiError('bad_record', `${where} ${message}`, {
    ...(source !== undefined && { source }),
  })
}

/** True for a lower-case 64-digit hex SHA-256 digest. */
export function isHex64(value: unknown): value is string {
  return typeof value === 'string' && HEX64.test(value)
}

function checkBitsPerTrial(value: unknown, where: string, source?: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 8) {
    fail(where, `has invalid bitsPerTrial ${String(value)}`, source)
  }
  return value
}

function checkTrialCore(record: Record<string, unknown>, where: string): void {
  const { t, source, sum, bitsPerTrial } = record
  if (typeof t !== 'number' || !Number.isFinite(t)) {
    fail(where, `has invalid timestamp ${String(t)}`)
  }
  if (typeof source !== 'string' || source.length === 0) {
    fail(where, `has invalid source ${String(source)}`)
  }
  const k = checkBitsPerTrial(bitsPerTrial, where, source)
  // `sum` counts one-bits among k bits: an integer in [0, k]. Anything else is
  // impossible under the schema and would let one corrupted line fabricate an
  // astronomically significant analysis.
  if (typeof sum !== 'number' || !Number.isInteger(sum) || sum < 0 || sum > k) {
    fail(where, `has invalid sum ${String(sum)} (must be an integer in [0, ${k}])`, source)
  }
}

function checkTags(record: Record<string, unknown>, where: string): void {
  const { arm, segment, run } = record
  if (arm !== undefined && arm !== 'experimental' && arm !== 'control') {
    fail(where, `has invalid arm ${String(arm)} (experimental | control)`)
  }
  if (segment !== undefined && (typeof segment !== 'string' || segment.length === 0)) {
    fail(where, `has invalid segment ${String(segment)}`)
  }
  if (run !== undefined && (typeof run !== 'number' || !Number.isSafeInteger(run) || run < 0)) {
    fail(where, `has invalid run ${String(run)}`)
  }
}

function checkHeader(record: Record<string, unknown>, where: string): void {
  for (const key of Object.keys(record)) {
    if (!HEADER_KEYS.has(key)) fail(where, `has unknown session-header field ${key}`)
  }
  const { sources, bitsPerTrial, registration, genesis } = record
  if (
    !Array.isArray(sources) ||
    sources.length === 0 ||
    sources.some((s) => typeof s !== 'string' || s.length === 0) ||
    new Set(sources).size !== sources.length
  ) {
    fail(where, 'needs a non-empty array of unique, non-empty source names')
  }
  checkBitsPerTrial(bitsPerTrial, where)
  if (registration !== undefined && !isHex64(registration)) {
    fail(where, 'has a registration that is not a lower-case hex SHA-256')
  }
  const expected = registration ?? ZERO_HASH
  if (genesis !== expected) {
    fail(
      where,
      `has genesis ${String(genesis)}; it must be ${registration !== undefined ? 'the registration hash' : '64 zeros'}`,
    )
  }
}

function checkTrialV2(record: Record<string, unknown>, where: string): void {
  for (const key of Object.keys(record)) {
    if (!TRIAL_V2_KEYS.has(key)) fail(where, `has unknown trial field ${key}`)
  }
  const { i, prev } = record
  if (typeof i !== 'number' || !Number.isSafeInteger(i) || i < 0) {
    fail(where, `has invalid line index i ${String(i)}`)
  }
  if (!isHex64(prev)) fail(where, 'has a prev that is not a lower-case hex SHA-256')
  checkTrialCore(record, where)
  checkTags(record, where)
}

/** Validate an already-decoded record object as a {@link SessionLine}; returns a frozen copy. */
function validateLine(value: unknown, where: string): SessionLine {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(where, 'is not a JSON object')
  }
  const record = value as Record<string, unknown>
  if (record.v === 1) {
    checkTrialCore(record, where)
    const { t, source, sum, bitsPerTrial } = record as unknown as SessionRecordLine
    return Object.freeze({ v: 1, t, source, sum, bitsPerTrial })
  }
  if (record.v !== 2) fail(where, `has unsupported version ${String(record.v)}`)
  if (record.kind !== undefined) {
    if (record.kind !== 'session') fail(where, `has unknown kind ${String(record.kind)}`)
    checkHeader(record, where)
    const header = record as unknown as SessionHeaderLine
    return Object.freeze({
      v: 2,
      kind: 'session',
      sources: Object.freeze([...header.sources]),
      bitsPerTrial: header.bitsPerTrial,
      ...(header.registration !== undefined && { registration: header.registration }),
      genesis: header.genesis,
    })
  }
  checkTrialV2(record, where)
  const trial = record as unknown as SessionTrialLine
  return Object.freeze({
    v: 2,
    i: trial.i,
    prev: trial.prev,
    t: trial.t,
    source: trial.source,
    sum: trial.sum,
    bitsPerTrial: trial.bitsPerTrial,
    ...(trial.arm !== undefined && { arm: trial.arm }),
    ...(trial.segment !== undefined && { segment: trial.segment }),
    ...(trial.run !== undefined && { run: trial.run }),
  })
}

/**
 * Serialize one record to its canonical JSONL line (no trailing newline):
 * fixed key order per line kind (see {@link SessionRecordLine},
 * {@link SessionHeaderLine}, {@link SessionTrialLine}), `JSON.stringify`
 * number and string encoding. The record is validated with the same rules as
 * {@link parseRecordLine}, so every emitted line parses back and
 * `serializeRecordLine(parseRecordLine(line)) === line` for canonical lines.
 *
 * @throws {PsiError} `bad_record` for a record that would not round-trip
 *   (non-finite `t`, sum outside $[0, k]$, malformed hash, unknown field, …).
 */
export function serializeRecordLine(line: SessionLine): string {
  const valid = validateLine(line, 'record')
  // validateLine returns objects whose own key order is the canonical order
  return JSON.stringify(valid)
}

/**
 * Parse and validate one JSONL line into a frozen {@link SessionLine}: a v1
 * trial, a v2 session header (`kind: 'session'`), or a v2 trial. Any malformed
 * line — bad JSON, unknown version, missing, ill-typed or non-finite fields,
 * `bitsPerTrial` < 8, a sum outside $[0, k]$, unknown v2 fields, a genesis that
 * does not match the registration — raises `PsiError('bad_record')` naming the
 * line. Structural only: hash links are checked by `verifyChain`.
 */
export function parseRecordLine(raw: string, lineNo?: number): SessionLine {
  const where = lineNo !== undefined ? `line ${lineNo}` : 'record'
  if (typeof raw !== 'string') fail(where, 'is not a string')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new PsiError('bad_record', `${where} is not valid JSON`, { cause })
  }
  return validateLine(parsed, where)
}
