import { PsiError } from '../errors.js'

/** One physical line of text and its 1-based line number. */
export interface NumberedLine {
  readonly text: string
  readonly lineNo: number
}

/**
 * How chunk boundaries relate to line boundaries:
 * - `'json-lines'` — a trailing segment without a newline is carried into the
 *   next chunk *unless it already is a complete JSON object*, so both arrays
 *   of unterminated lines (`recordSession` output, `readline`) and arbitrary
 *   byte-stream chunks split mid-record work. A JSON object's text has exactly
 *   one top-level closing brace, at its end, so no proper prefix of a record
 *   parses.
 * - `'text'` — chunks are pieces of one text stream (e.g. from a
 *   `TextDecoderStream`); only newlines end lines.
 */
export type Framing = 'json-lines' | 'text'

function isCompleteJsonObject(segment: string): boolean {
  const trimmed = segment.trimEnd()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false
  try {
    const value: unknown = JSON.parse(trimmed)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  } catch {
    return false
  }
}

/** A `ReadableStream` without `Symbol.asyncIterator` (older engines): iterate via its reader. */
function readerFallback<T>(input: T): T | AsyncIterable<string> {
  if (
    input === null ||
    typeof input !== 'object' ||
    Symbol.asyncIterator in input ||
    Symbol.iterator in input ||
    typeof (input as { getReader?: unknown }).getReader !== 'function'
  ) {
    return input
  }
  const stream = input as unknown as ReadableStream<string>
  return {
    async *[Symbol.asyncIterator]() {
      const reader = stream.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) return
          yield value
        }
      } finally {
        reader.releaseLock()
      }
    },
  }
}

/**
 * Split a string, or a sync/async iterable of string chunks, into numbered
 * lines. `\n` and `\r\n` both terminate a line; a final unterminated segment
 * is the last line. Blank lines are yielded (and numbered) — callers skip
 * them. A lone string is one chunk, never an iterable of characters; a
 * `ReadableStream` of strings without `Symbol.asyncIterator` is read through
 * its reader.
 *
 * @throws {PsiError} `invalid_plan` when the input is not a string or
 *   iterable, or a chunk is not a string.
 */
export async function* textLines(
  input: string | Iterable<string> | AsyncIterable<string>,
  framing: Framing,
): AsyncGenerator<NumberedLine> {
  const chunks: Iterable<string> | AsyncIterable<string> =
    typeof input === 'string' ? [input] : readerFallback(input)
  if (
    chunks === null ||
    typeof chunks !== 'object' ||
    !(Symbol.asyncIterator in chunks || Symbol.iterator in chunks)
  ) {
    throw new PsiError('invalid_plan', 'input must be a string or an iterable of strings')
  }
  let carry = ''
  let lineNo = 0
  // a segment emitted early (complete JSON without its newline) still owns the next '\n'
  let awaitingTerminator = false
  for await (const chunk of chunks) {
    if (typeof chunk !== 'string') {
      throw new PsiError('invalid_plan', `input chunks must be strings, got ${typeof chunk}`)
    }
    if (chunk.length === 0) continue
    let text = carry + chunk
    carry = ''
    if (awaitingTerminator) {
      if (text === '\r') {
        carry = text // the '\n' may arrive in the next chunk
        continue
      }
      if (text.startsWith('\r\n')) text = text.slice(2)
      else if (text.startsWith('\n')) text = text.slice(1)
      awaitingTerminator = false
    }
    const parts = text.split('\n')
    carry = parts.pop() as string
    for (const part of parts) {
      lineNo++
      yield { text: part.endsWith('\r') ? part.slice(0, -1) : part, lineNo }
    }
    if (framing === 'json-lines' && carry.length > 0 && isCompleteJsonObject(carry)) {
      lineNo++
      yield { text: carry, lineNo }
      carry = ''
      awaitingTerminator = true
    }
  }
  if (carry.length > 0 && !(awaitingTerminator && carry === '\r')) {
    lineNo++
    yield { text: carry.endsWith('\r') ? carry.slice(0, -1) : carry, lineNo }
  }
}
