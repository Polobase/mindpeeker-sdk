import { parseEntry } from './chain.js'
import { LedgerError } from './errors.js'
import { isHashHex, sha256Hex, ZERO_HASH } from './hash.js'
import type { ChainHead } from './types.js'

/**
 * Line layout {@link verifyChain} expects.
 *
 * - `ledger` — every line is a canonical `{ i, prev, record }` entry
 *   (`appendEntry` output); no header; entry 0's `prev` is the genesis.
 * - `psi` — `@mindpeeker/psi` JSONL schema v2: line 0 is the session header
 *   `{"v":2,"kind":"session",…,"genesis":…}` (no `prev`), every later line a
 *   `{"v":2,"i":…,"prev":…,…}` trial whose `i` counts from 0 and whose `prev`
 *   is the SHA-256 of the previous line (the header for `i = 0`).
 * - `auto` (default) — the common rule of both: line 0 may be an unlinked
 *   header (a JSON object without `prev`); every other line is a JSON object
 *   with `i` = its position among linked lines and `prev` = SHA-256 of the
 *   previous line's exact text. No canonical-form or field checks. Prefer the
 *   explicit format: `auto` cannot tell a header from a ledger entry whose
 *   `prev` was stripped (later links still break unless all were rewritten,
 *   which only a published `head` exposes).
 */
export type ChainFormat = 'auto' | 'ledger' | 'psi'

/** Machine-readable reason a chain failed to verify. */
export type ChainFailure =
  | 'empty' // no non-blank lines
  | 'not_json' // a line is not valid JSON
  | 'not_object' // a line is not a JSON object
  | 'not_canonical' // ledger format: not a canonical { i, prev, record } entry
  | 'bad_record' // psi format: a later line is not a schema-v2 trial
  | 'bad_header' // header missing, malformed, or genesis/registration mismatch
  | 'missing_link' // a line after the first lacks prev or i
  | 'bad_index' // i is not the line's position among linked lines
  | 'bad_prev' // prev is not the SHA-256 of the previous line (or the genesis)
  | 'head_mismatch' // all links hold but the final head differs from the expected head

/** Options for {@link verifyChain}. */
export interface VerifyChainOptions {
  /** Line layout. Default `'auto'`. */
  format?: ChainFormat
  /**
   * Expected genesis (lower-case hex SHA-256). Without a header it is entry
   * 0's `prev` (default {@link ZERO_HASH}); with a header it must equal the
   * header's `genesis` member (unchecked when omitted).
   */
  genesis?: string
  /**
   * A published head (lower-case hex SHA-256). Without it truncation at the
   * end is undetectable; with it any missing or extra trailing line fails
   * with `head_mismatch`.
   */
  head?: string
}

/** The result of {@link verifyChain}. */
export interface ChainVerification {
  readonly ok: boolean
  /** Non-blank lines examined (a header included), up to and including a break. */
  readonly lines: number
  /** Linked lines (entries/trials) verified before any break. */
  readonly entries: number
  /** When `ok`: SHA-256 hex of the last line — the value to publish or timestamp. */
  readonly head?: string
  /** When `ok` and the chain has no header: the state `appendEntry` continues from. */
  readonly chain?: ChainHead
  /** 0-based index among non-blank lines of the first failing line (`lines` for `head_mismatch`). */
  readonly brokenAt?: number
  readonly failure?: ChainFailure
  /** Human-readable detail. */
  readonly reason?: string
}

type Lines = string | Iterable<string> | AsyncIterable<string>

/** Yield non-blank lines: split on `\n`, drop one trailing `\r`, skip whitespace-only lines. */
async function* nonBlankLines(input: Lines): AsyncGenerator<string> {
  const split = function* (text: string): Generator<string> {
    for (const raw of text.split('\n')) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      if (line.trim() !== '') yield line
    }
  }
  if (typeof input === 'string') {
    yield* split(input)
    return
  }
  if (
    input === null ||
    typeof input !== 'object' ||
    !(Symbol.iterator in input || Symbol.asyncIterator in input)
  ) {
    throw new LedgerError(
      'invalid_input',
      'lines must be a string or an (async) iterable of strings',
    )
  }
  for await (const element of input) {
    if (typeof element !== 'string') {
      throw new LedgerError('invalid_input', 'every element of lines must be a string')
    }
    yield* split(element)
  }
}

function checkOptions(opts: VerifyChainOptions): Required<Pick<VerifyChainOptions, 'format'>> {
  if (opts === null || typeof opts !== 'object') {
    throw new LedgerError('invalid_input', 'verifyChain options must be an object')
  }
  const format = opts.format ?? 'auto'
  if (format !== 'auto' && format !== 'ledger' && format !== 'psi') {
    throw new LedgerError('invalid_input', `unknown chain format ${String(format)}`)
  }
  for (const key of ['genesis', 'head'] as const) {
    if (opts[key] !== undefined && !isHashHex(opts[key])) {
      throw new LedgerError('invalid_input', `${key} must be a lower-case hex SHA-256`)
    }
  }
  return { format }
}

function fail(
  lines: number,
  entries: number,
  brokenAt: number,
  failure: ChainFailure,
  reason: string,
): ChainVerification {
  return Object.freeze({ ok: false, lines, entries, brokenAt, failure, reason })
}

/** Why a psi header is unacceptable, or undefined. */
function psiHeaderProblem(record: Record<string, unknown>): string | undefined {
  if (record.v !== 2 || record.kind !== 'session') return 'is not a psi schema-v2 session header'
  if (!isHashHex(record.genesis)) return 'has a genesis that is not a lower-case hex SHA-256'
  if (record.registration !== undefined) {
    if (!isHashHex(record.registration)) return 'has a malformed registration hash'
    if (record.genesis !== record.registration) return 'has a genesis other than its registration'
  } else if (record.genesis !== ZERO_HASH) {
    return 'has a non-zero genesis but no registration'
  }
  return undefined
}

/**
 * Verify a hash-chained JSONL log line by line. Every linked line must carry
 * `i` equal to its position among linked lines and `prev` equal to the
 * lower-case hex SHA-256 of the **exact UTF-8 text** of the line before it —
 * the text is hashed as given, never re-serialized, so recordings produced by
 * other tools verify byte-for-byte. See {@link ChainFormat} for the ledger
 * and psi schema-v2 layouts.
 *
 * Input: a whole JSONL string, or an (async) iterable of strings each holding
 * one or more complete lines. Lines split on `\n`; a trailing `\r` is dropped
 * before hashing; whitespace-only lines are ignored. Stops at the first break.
 *
 * What a successful result proves: the lines are mutually consistent and end
 * in `head`. It does not prove when they were written, or that nothing was
 * cut from the end — compare `head` to one published or timestamped earlier
 * (the `head` option).
 *
 * Never throws for content problems (they are reported with `failure` and
 * `brokenAt`).
 *
 * @throws {LedgerError} `invalid_input` for malformed options or input types;
 *   `crypto_unavailable` without WebCrypto.
 */
export async function verifyChain(
  lines: Lines,
  opts: VerifyChainOptions = {},
): Promise<ChainVerification> {
  const { format } = checkOptions(opts)
  const genesis = opts.genesis ?? ZERO_HASH
  let index = 0
  let entries = 0
  let hasHeader = false
  let expectedPrev = genesis
  for await (const text of nonBlankLines(lines)) {
    const seen = index + 1
    let record: Record<string, unknown>
    if (format === 'ledger') {
      try {
        record = parseEntry(text) as unknown as Record<string, unknown>
      } catch (error) {
        return fail(seen, entries, index, 'not_canonical', (error as Error).message)
      }
    } else {
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        return fail(seen, entries, index, 'not_json', `line ${index} is not valid JSON`)
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return fail(seen, entries, index, 'not_object', `line ${index} is not a JSON object`)
      }
      record = parsed as Record<string, unknown>
    }
    const linked = Object.hasOwn(record, 'prev')
    if (index === 0 && (format === 'psi' || (format === 'auto' && !linked))) {
      const problem = format === 'psi' ? psiHeaderProblem(record) : undefined
      if (problem !== undefined) return fail(1, 0, 0, 'bad_header', `line 0 ${problem}`)
      if (opts.genesis !== undefined && record.genesis !== opts.genesis) {
        return fail(1, 0, 0, 'bad_header', 'line 0 does not carry the expected genesis')
      }
      hasHeader = true
    } else {
      if (!linked || !Object.hasOwn(record, 'i')) {
        return fail(seen, entries, index, 'missing_link', `line ${index} lacks i or prev`)
      }
      if (format === 'psi' && (record.v !== 2 || Object.hasOwn(record, 'kind'))) {
        return fail(seen, entries, index, 'bad_record', `line ${index} is not a psi v2 trial`)
      }
      if (record.i !== entries) {
        return fail(
          seen,
          entries,
          index,
          'bad_index',
          `line ${index} has i ${String(record.i)}, expected ${entries}`,
        )
      }
      if (record.prev !== expectedPrev) {
        const what = index === 0 ? 'the genesis' : 'the SHA-256 of the line before it'
        return fail(seen, entries, index, 'bad_prev', `line ${index} prev is not ${what}`)
      }
      entries++
    }
    expectedPrev = await sha256Hex(text)
    index++
  }
  if (index === 0) return fail(0, 0, 0, 'empty', 'there are no lines')
  if (opts.head !== undefined && expectedPrev !== opts.head) {
    return fail(
      index,
      entries,
      index,
      'head_mismatch',
      'the chain is consistent but ends in a different head (truncated or extended)',
    )
  }
  return Object.freeze({
    ok: true,
    lines: index,
    entries,
    head: expectedPrev,
    ...(!hasHeader && {
      chain: Object.freeze({ genesis, head: expectedPrev, size: entries }),
    }),
  })
}
