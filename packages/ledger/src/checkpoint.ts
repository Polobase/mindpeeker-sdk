import { LedgerError } from './errors.js'
import { base64ToBytes, bytesToBase64 } from './internal/bytes.js'
import { HASH_BYTES, merkleRoot } from './merkle.js'
import {
  checkNoteText,
  type NoteVerification,
  parseSignedNote,
  serializeSignedNote,
  type VerifyNoteOptions,
  verifyNote,
} from './note.js'
import type { BytesInput, Checkpoint, NoteSignature, VerifierKey } from './types.js'

function invalid(message: string): never {
  throw new LedgerError('invalid_note', message)
}

/** A checkpoint as parsed from text: the body fields plus the exact signed text and signatures. */
export interface ParsedCheckpoint extends Checkpoint {
  /** The note text exactly as signed (ends in a newline). */
  readonly text: string
  /** Signature lines (empty for a bare, unsigned body). */
  readonly signatures: readonly NoteSignature[]
}

const SIZE = /^(?:0|[1-9][0-9]*)$/

function parseBody(text: string): Checkpoint {
  if (!text.endsWith('\n')) invalid('checkpoint text must end with a newline')
  const lines = text.slice(0, -1).split('\n')
  if (lines.length < 3) invalid('checkpoint text needs origin, tree size and root hash lines')
  if (lines.some((line) => line === '')) invalid('checkpoint lines must be non-empty')
  const [origin, sizeText, rootText, ...extensions] = lines as [string, string, string, ...string[]]
  if (!SIZE.test(sizeText)) invalid('tree size must be decimal without leading zeros')
  const size = Number(sizeText)
  if (!Number.isSafeInteger(size)) invalid('tree size exceeds Number.MAX_SAFE_INTEGER')
  const root = base64ToBytes(rootText)
  if (root === undefined || root.length !== HASH_BYTES) {
    invalid('root hash must be the strict base64 of 32 bytes')
  }
  return Object.freeze({ origin, size, root, extensions: Object.freeze(extensions) })
}

/**
 * The note text of a C2SP tlog checkpoint: origin, decimal tree size, base64
 * root hash, then any extension lines, each ending in a newline. This is the
 * exact text a log signs.
 *
 * @throws {LedgerError} `invalid_note` for an empty origin or extension line,
 *   a size that is not a safe integer ≥ 0, a root that is not 32 bytes, or
 *   characters a signed note may not contain.
 */
export function checkpointText(checkpoint: Checkpoint): string {
  if (checkpoint === null || typeof checkpoint !== 'object') invalid('checkpoint must be an object')
  const { origin, size, root } = checkpoint
  const extensions = checkpoint.extensions ?? []
  if (typeof origin !== 'string' || origin === '' || origin.includes('\n')) {
    invalid('origin must be a non-empty single line')
  }
  if (!Number.isSafeInteger(size) || size < 0) invalid('size must be a safe integer ≥ 0')
  if (!(root instanceof Uint8Array) || root.length !== HASH_BYTES) invalid('root must be 32 bytes')
  if (!Array.isArray(extensions)) invalid('extensions must be an array of lines')
  for (const line of extensions) {
    if (typeof line !== 'string' || line === '' || line.includes('\n')) {
      invalid('extension lines must be non-empty single lines')
    }
  }
  const text = `${[origin, String(size), bytesToBase64(root), ...extensions].join('\n')}\n`
  checkNoteText(text, 'checkpoint')
  return text
}

/**
 * Parse a checkpoint: a signed note whose text is a checkpoint body, or a
 * bare body with no signature block. Signatures are not verified here — see
 * {@link verifyCheckpoint}.
 *
 * @throws {LedgerError} `invalid_note` for malformed text.
 */
export function parseCheckpoint(message: string): ParsedCheckpoint {
  if (typeof message !== 'string') invalid('a checkpoint must be a string')
  // Checkpoint lines are non-empty, so any blank line starts the signature block.
  checkNoteText(message, 'checkpoint')
  const note = message.includes('\n\n')
    ? parseSignedNote(message)
    : { text: message, signatures: Object.freeze([]) }
  const body = parseBody(note.text)
  return Object.freeze({ ...body, text: note.text, signatures: note.signatures })
}

/**
 * Serialize a checkpoint: its text followed by a blank line and signature
 * lines, or the bare text when there are no signatures.
 *
 * @throws {LedgerError} `invalid_note` as {@link checkpointText} and for bad signature lines.
 */
export function serializeCheckpoint(
  checkpoint: Checkpoint,
  signatures: readonly NoteSignature[] = [],
): string {
  const text = checkpointText(checkpoint)
  return signatures.length === 0 ? text : serializeSignedNote({ text, signatures })
}

/**
 * The checkpoint body of a log: `origin`, the number of leaves and their RFC
 * 6962 root. Sign `checkpointText(result)` (e.g. with `signNote`) to publish it.
 */
export async function checkpointOf(
  origin: string,
  leaves: readonly BytesInput[],
): Promise<Checkpoint> {
  const checkpoint = Object.freeze({
    origin,
    size: Array.isArray(leaves) ? leaves.length : 0,
    root: await merkleRoot(leaves),
    extensions: Object.freeze([]),
  })
  checkpointText(checkpoint)
  return checkpoint
}

/** Outcome of {@link verifyCheckpoint}. */
export interface CheckpointVerification extends NoteVerification {
  /** The parsed checkpoint, when the text parsed. */
  readonly checkpoint?: ParsedCheckpoint
}

/** Options for {@link verifyCheckpoint}. */
export interface VerifyCheckpointOptions extends VerifyNoteOptions {
  /** Required origin line; a different origin makes the result `failed`. */
  origin?: string
}

/**
 * Parse a signed checkpoint and verify its signatures against trusted
 * verifier keys (see `verifyNote`: unknown keys ignored, Ed25519 via
 * WebCrypto, one failure rejects). Unparseable text is reported as `failed`
 * rather than thrown. A `verified` checkpoint proves only that the key holder
 * signed this tree head; compare `checkpoint.root` with your own
 * `merkleRoot`, and check consistency with earlier checkpoints
 * (`verifyConsistency`) to detect a log that forks its history.
 *
 * @throws {LedgerError} `invalid_note`/`invalid_input` for malformed or duplicate keys.
 */
export async function verifyCheckpoint(
  message: string,
  keys: readonly (string | VerifierKey)[],
  opts: VerifyCheckpointOptions = {},
): Promise<CheckpointVerification> {
  let checkpoint: ParsedCheckpoint
  try {
    checkpoint = parseCheckpoint(message)
  } catch (error) {
    const reason = error instanceof LedgerError ? error.message : 'checkpoint does not parse'
    return Object.freeze({
      status: 'failed',
      verified: [],
      failed: [],
      unknown: [],
      unsupported: [],
      reason,
    })
  }
  const result = await verifyNote(checkpoint, keys, opts)
  if (opts.origin !== undefined && checkpoint.origin !== opts.origin) {
    return Object.freeze({
      ...result,
      status: 'failed',
      reason: `origin ${JSON.stringify(checkpoint.origin)} is not the expected origin`,
      checkpoint,
    })
  }
  return Object.freeze({ ...result, checkpoint })
}
