import { canonicalize } from './canonical.js'
import { LedgerError } from './errors.js'
import { isHashHex, sha256Hex, ZERO_HASH } from './hash.js'
import type { ChainEntry, ChainHead } from './types.js'

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key])
  }
  return value
}

/**
 * The head of an empty chain. `genesis` becomes entry 0's `prev`: bind a
 * chain to something published in advance (a registration hash) by passing
 * it here; the default is 64 zeros.
 *
 * @throws {LedgerError} `invalid_input` unless `genesis` is lower-case hex SHA-256.
 */
export function startChain(genesis: string = ZERO_HASH): ChainHead {
  if (!isHashHex(genesis)) {
    throw new LedgerError('invalid_input', 'genesis must be a lower-case hex SHA-256 (64 digits)')
  }
  return Object.freeze({ genesis, head: genesis, size: 0 })
}

function checkHead(chain: ChainHead): void {
  if (chain === null || typeof chain !== 'object') {
    throw new LedgerError('invalid_input', 'chain must be a ChainHead { genesis, head, size }')
  }
  if (!isHashHex(chain.genesis) || !isHashHex(chain.head)) {
    throw new LedgerError('invalid_input', 'chain genesis and head must be lower-case hex SHA-256')
  }
  if (!Number.isSafeInteger(chain.size) || chain.size < 0) {
    throw new LedgerError('invalid_input', 'chain size must be a safe integer ≥ 0')
  }
  if (chain.size === 0 && chain.head !== chain.genesis) {
    throw new LedgerError('invalid_input', 'an empty chain must have head === genesis')
  }
}

/** The result of {@link appendEntry}. */
export interface AppendResult {
  /** The JSONL line to persist (no trailing newline). */
  readonly line: string
  /** The entry the line encodes. */
  readonly entry: ChainEntry
  /** The chain after this entry: `head` = SHA-256 hex of `line`. */
  readonly chain: ChainHead
}

/**
 * Append a record to a hash chain. The line is the RFC 8785 canonical JSON of
 * `{ i, prev, record }` with `i = chain.size` and `prev = chain.head`; the new
 * head is the SHA-256 (hex) of the line's UTF-8 bytes. Pure: nothing is
 * stored — write `line` + `"\n"` wherever the log lives and keep the returned
 * `chain` for the next append.
 *
 * A chain detects any edit, insertion, deletion or reordering of earlier
 * lines, but truncation at the end only against a head published (or
 * timestamped) elsewhere — see `verifyChain`'s `head` option.
 *
 * @throws {LedgerError} `invalid_json` when `record` is not canonical JSON;
 *   `invalid_input` for a malformed `chain`.
 */
export async function appendEntry(chain: ChainHead, record: unknown): Promise<AppendResult> {
  checkHead(chain)
  if (!Number.isSafeInteger(chain.size + 1)) {
    throw new LedgerError('invalid_input', 'chain size would exceed Number.MAX_SAFE_INTEGER')
  }
  const line = canonicalize({ i: chain.size, prev: chain.head, record })
  const entry = deepFreeze(JSON.parse(line) as ChainEntry)
  const head = await sha256Hex(line)
  return Object.freeze({
    line,
    entry,
    chain: Object.freeze({ genesis: chain.genesis, head, size: chain.size + 1 }),
  })
}

/**
 * Parse one ledger chain line strictly: JSON with exactly the members `i`
 * (safe integer ≥ 0), `prev` (lower-case hex SHA-256) and `record`, in RFC
 * 8785 canonical form — so the hashed bytes are the only valid encoding of
 * the entry. Links between lines are checked by `verifyChain`.
 *
 * @throws {LedgerError} `invalid_entry` naming what is wrong.
 */
export function parseEntry(line: string): ChainEntry {
  if (typeof line !== 'string') throw new LedgerError('invalid_entry', 'a line must be a string')
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch (cause) {
    throw new LedgerError('invalid_entry', 'line is not valid JSON', { cause })
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LedgerError('invalid_entry', 'line is not a JSON object')
  }
  const object: object = parsed
  const keys = Object.keys(object)
  if (keys.length !== 3 || !['i', 'prev', 'record'].every((key) => Object.hasOwn(object, key))) {
    throw new LedgerError('invalid_entry', 'entry must have exactly the members i, prev, record')
  }
  const { i, prev } = parsed as { i: unknown; prev: unknown }
  if (typeof i !== 'number' || !Number.isSafeInteger(i) || i < 0) {
    throw new LedgerError('invalid_entry', `entry i ${String(i)} is not a safe integer ≥ 0`)
  }
  if (!isHashHex(prev)) {
    throw new LedgerError('invalid_entry', 'entry prev is not a lower-case hex SHA-256')
  }
  let canonical: string
  try {
    canonical = canonicalize(parsed)
  } catch (cause) {
    throw new LedgerError('invalid_entry', 'entry is not representable as canonical JSON', {
      cause,
    })
  }
  if (canonical !== line) {
    throw new LedgerError('invalid_entry', 'line is not in RFC 8785 canonical form')
  }
  return deepFreeze(parsed as ChainEntry)
}
