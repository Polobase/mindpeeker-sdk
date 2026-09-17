import { PsiError } from '../errors.js'
import { sha256Hex } from '../internal/digest.js'
import { textLines } from '../internal/text-lines.js'
import {
  isHex64,
  parseRecordLine,
  type SessionHeaderLine,
  type SessionLine,
  serializeRecordLine,
} from './line.js'

/** Options for {@link verifyChain}. */
export interface VerifyChainOptions {
  /**
   * Require the recording to be bound to this registration hash (lower-case
   * hex SHA-256): the header's `registration` and `genesis` must equal it.
   */
  registration?: string
}

/** The result of {@link verifyChain}. */
export interface ChainVerification {
  /** Every line parsed, is canonical, and links to its predecessor. */
  readonly ok: boolean
  /** Non-blank lines examined (the header included), up to and including a break. */
  readonly lines: number
  /**
   * Chain head when `ok`: the SHA-256 of the last line — the 32 bytes to
   * publish or timestamp, and the `prev` a continuation's next line would carry.
   */
  readonly head?: string
  /** 0-based index among non-blank lines (0 = header) of the first failing line. */
  readonly brokenAt?: number
  /** Why the line at `brokenAt` fails. */
  readonly reason?: string
}

function broken(lines: number, brokenAt: number, reason: string): ChainVerification {
  return Object.freeze({ ok: false, lines, brokenAt, reason })
}

/**
 * Verify a schema-v2 session recording end to end: line 0 must be a session
 * header (with the expected registration, if given); every later line a v2
 * trial with `i` counting from 0, a source and `bitsPerTrial` declared in
 * the header, and `prev` equal to the SHA-256 (hex) of the previous line's
 * exact text. Every line must also be in canonical form
 * (`serializeRecordLine(parseRecordLine(line)) === line`), so the bytes that
 * were hashed are the only valid encoding of the record.
 *
 * An edited, inserted, deleted, or reordered line breaks the chain at the
 * first line whose `prev` no longer matches; truncation at the end is only
 * detectable against a published head (compare `head`). A hash chain proves
 * internal consistency, not *when* lines were written — publish or timestamp
 * the head (or seal it with a beacon/VDF) to fix it in time.
 *
 * Accepts the same inputs as `readSession` (a whole string, line arrays with
 * or without terminators, or byte-stream chunks). Blank lines are ignored.
 * Stops reading at the first break. Never throws for content problems — they
 * are reported in the result.
 *
 * @throws {PsiError} `invalid_plan` for a malformed `registration` option or
 *   an input that is not a string/iterable of strings.
 */
export async function verifyChain(
  lines: string | Iterable<string> | AsyncIterable<string>,
  opts: VerifyChainOptions = {},
): Promise<ChainVerification> {
  if (opts === null || typeof opts !== 'object') {
    throw new PsiError('invalid_plan', 'verifyChain options must be an object')
  }
  if (opts.registration !== undefined && !isHex64(opts.registration)) {
    throw new PsiError('invalid_plan', 'registration must be a lower-case hex SHA-256')
  }
  let index = 0
  let header: SessionHeaderLine | undefined
  let expectedPrev = ''
  for await (const { text, lineNo } of textLines(lines, 'json-lines')) {
    if (text.trim() === '') continue
    let record: SessionLine
    try {
      record = parseRecordLine(text, lineNo)
    } catch (error) {
      return broken(index + 1, index, (error as Error).message)
    }
    if (serializeRecordLine(record) !== text) {
      return broken(index + 1, index, `line ${lineNo} is not in canonical form`)
    }
    if (index === 0) {
      if (record.v !== 2 || !('kind' in record)) {
        return broken(1, 0, `line ${lineNo} is not a schema-v2 session header`)
      }
      if (opts.registration !== undefined && record.registration !== opts.registration) {
        return broken(1, 0, `line ${lineNo} is not bound to registration ${opts.registration}`)
      }
      header = record
    } else {
      const h = header as SessionHeaderLine
      if (record.v !== 2 || 'kind' in record) {
        return broken(index + 1, index, `line ${lineNo} is not a schema-v2 trial line`)
      }
      if (record.i !== index - 1) {
        return broken(index + 1, index, `line ${lineNo} has i ${record.i}, expected ${index - 1}`)
      }
      if (record.prev !== expectedPrev) {
        return broken(
          index + 1,
          index,
          `line ${lineNo} prev does not match the SHA-256 of the line before it`,
        )
      }
      if (!h.sources.includes(record.source)) {
        return broken(
          index + 1,
          index,
          `line ${lineNo} source ${record.source} is not in the header`,
        )
      }
      if (record.bitsPerTrial !== h.bitsPerTrial) {
        return broken(
          index + 1,
          index,
          `line ${lineNo} bitsPerTrial ${record.bitsPerTrial} differs from the header's ${h.bitsPerTrial}`,
        )
      }
    }
    expectedPrev = await sha256Hex(text)
    index++
  }
  if (index === 0) return broken(0, 0, 'the recording is empty')
  return Object.freeze({ ok: true, lines: index, head: expectedPrev })
}
