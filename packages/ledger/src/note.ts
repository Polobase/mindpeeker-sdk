import { LedgerError } from './errors.js'
import { base64ToBytes, bytesToBase64, concatBytes, requireBytes } from './internal/bytes.js'
import { defaultSubtle, digest256 } from './internal/subtle.js'
import type { NoteSignature, SignedNote, VerifierKey } from './types.js'

/** Signature type byte of Ed25519 note signatures (C2SP signed-note). */
export const ED25519_TYPE = 0x01
/** Most signature lines accepted in one note (the spec requires at least 16). */
export const MAX_NOTE_SIGNATURES = 100

const EM_DASH = String.fromCodePoint(0x2014)
const SIG_PREFIX = `${EM_DASH} `
const encoder = new TextEncoder()

function invalid(message: string): never {
  throw new LedgerError('invalid_note', message)
}

/** Key names: non-empty, no Unicode spaces, no `+`. */
function isKeyName(name: string): boolean {
  return name.length > 0 && !/[\s+]/u.test(name)
}

/**
 * Signed notes are valid Unicode with no ASCII control characters except
 * newline. Internal (not re-exported from the package index).
 */
export function checkNoteText(text: string, what: string): void {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i)
    if (unit < 0x20 && unit !== 0x0a) invalid(`${what} contains a control character`)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) invalid(`${what} contains a lone surrogate`)
      i++
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      invalid(`${what} contains a lone surrogate`)
    }
  }
}

function signatureLine(sig: NoteSignature): string {
  if (!isKeyName(sig.name)) invalid(`signature key name ${JSON.stringify(sig.name)} is invalid`)
  if (!Number.isInteger(sig.keyId) || sig.keyId < 0 || sig.keyId > 0xffffffff) {
    invalid('signature keyId must be a uint32')
  }
  const bytes = requireBytes(sig.signature, 'signature')
  if (bytes.length === 0) invalid('signature bytes must not be empty')
  const id = new Uint8Array(4)
  new DataView(id.buffer).setUint32(0, sig.keyId)
  return `${SIG_PREFIX}${sig.name} ${bytesToBase64(concatBytes(id, bytes))}\n`
}

/**
 * Parse a C2SP signed note: the text (ending in a newline), a blank line, and
 * one or more lines `— <key name> base64(keyId ‖ signature)`. The text is
 * everything up to the **last** blank line, so it may itself contain blank
 * lines. Signatures are parsed but not checked — see {@link verifyNote}.
 *
 * @throws {LedgerError} `invalid_note` for malformed notes (control
 *   characters, no signature block, a bad signature line, strict-base64
 *   violations, more than {@link MAX_NOTE_SIGNATURES} signatures).
 */
export function parseSignedNote(message: string): SignedNote {
  if (typeof message !== 'string') invalid('a signed note must be a string')
  checkNoteText(message, 'note')
  const split = message.lastIndexOf('\n\n')
  if (split < 0) invalid('note has no blank line before its signatures')
  const text = message.slice(0, split + 1)
  const block = message.slice(split + 2)
  if (block === '' || !block.endsWith('\n')) invalid('note signatures must end with a newline')
  const lines = block.slice(0, -1).split('\n')
  if (lines.length > MAX_NOTE_SIGNATURES) invalid('note has too many signatures')
  const signatures = lines.map((line): NoteSignature => {
    if (!line.startsWith(SIG_PREFIX))
      invalid('a signature line must start with an em dash and a space')
    const rest = line.slice(SIG_PREFIX.length)
    const space = rest.indexOf(' ')
    if (space < 0) invalid('a signature line needs a key name and a signature')
    const name = rest.slice(0, space)
    if (!isKeyName(name)) invalid(`signature key name ${JSON.stringify(name)} is invalid`)
    const bytes = base64ToBytes(rest.slice(space + 1))
    if (bytes === undefined || bytes.length < 5) invalid(`signature of ${name} is not valid base64`)
    const keyId = new DataView(bytes.buffer).getUint32(0)
    return Object.freeze({ name, keyId, signature: bytes.slice(4) })
  })
  return Object.freeze({ text, signatures: Object.freeze(signatures) })
}

/**
 * Serialize a signed note: `text`, a blank line, one line per signature.
 *
 * @throws {LedgerError} `invalid_note` when the text does not end in a newline
 *   or contains control characters, a key name is invalid, or there are no signatures.
 */
export function serializeSignedNote(note: SignedNote): string {
  if (note === null || typeof note !== 'object' || typeof note.text !== 'string') {
    invalid('note must be { text, signatures }')
  }
  checkNoteText(note.text, 'note text')
  if (!note.text.endsWith('\n')) invalid('note text must end with a newline')
  if (!Array.isArray(note.signatures) || note.signatures.length === 0) {
    invalid('a signed note needs at least one signature')
  }
  return `${note.text}\n${note.signatures.map(signatureLine).join('')}`
}

/** C2SP key ID: the first four bytes (big-endian) of SHA-256(name ‖ 0x0A ‖ type ‖ publicKey). */
export async function noteKeyId(
  name: string,
  type: number,
  publicKey: Uint8Array,
): Promise<number> {
  if (!isKeyName(name)) invalid(`key name ${JSON.stringify(name)} is invalid`)
  if (!Number.isInteger(type) || type < 0 || type > 255) invalid('type must be a byte')
  const digest = await digest256(
    concatBytes(
      encoder.encode(name),
      new Uint8Array([0x0a, type]),
      requireBytes(publicKey, 'publicKey'),
    ),
  )
  return new DataView(digest.buffer).getUint32(0)
}

/**
 * Parse a verifier key `<name>+<8 hex digits>+base64(type ‖ publicKey)`. For
 * Ed25519 keys (type `0x01`) the public key must be 32 bytes and the key ID
 * must equal {@link noteKeyId} — as Go's `note.NewVerifier` requires. Other
 * types are parsed but cannot be verified by this package.
 *
 * @throws {LedgerError} `invalid_note` for a malformed key.
 */
export async function parseVerifierKey(vkey: string): Promise<VerifierKey> {
  if (typeof vkey !== 'string') invalid('a verifier key must be a string')
  const first = vkey.indexOf('+')
  const second = vkey.indexOf('+', first + 1)
  if (first < 0 || second < 0) invalid('verifier key must be <name>+<hex id>+<base64 key>')
  const name = vkey.slice(0, first)
  const idHex = vkey.slice(first + 1, second)
  if (!isKeyName(name)) invalid(`verifier key name ${JSON.stringify(name)} is invalid`)
  if (!/^[0-9a-f]{8}$/.test(idHex)) invalid('verifier key id must be 8 lower-case hex digits')
  const material = base64ToBytes(vkey.slice(second + 1))
  if (material === undefined || material.length < 2) invalid('verifier key material is not base64')
  const type = material[0] as number
  const publicKey = material.slice(1)
  const keyId = Number.parseInt(idHex, 16)
  if (type === ED25519_TYPE) {
    if (publicKey.length !== 32) invalid('an Ed25519 verifier key must hold 32 bytes')
    if ((await noteKeyId(name, type, publicKey)) !== keyId) {
      invalid('verifier key id does not match SHA-256(name ‖ 0x0A ‖ type ‖ key)')
    }
  }
  return Object.freeze({ name, keyId, type, publicKey })
}

/** Format an Ed25519 verifier key string for `name` and a raw 32-byte public key. */
export async function ed25519VerifierKey(name: string, publicKey: Uint8Array): Promise<string> {
  const key = requireBytes(publicKey, 'publicKey')
  if (key.length !== 32) throw new LedgerError('invalid_input', 'publicKey must be 32 bytes')
  const id = await noteKeyId(name, ED25519_TYPE, key)
  const material = bytesToBase64(concatBytes(new Uint8Array([ED25519_TYPE]), key))
  return `${name}+${id.toString(16).padStart(8, '0')}+${material}`
}

/** A signing identity for {@link signNote}: a WebCrypto Ed25519 private key and its raw public key. */
export interface NoteSigner {
  readonly name: string
  readonly privateKey: CryptoKey
  readonly publicKey: Uint8Array
}

/**
 * Sign note text with Ed25519 (RFC 8032, deterministic) through WebCrypto.
 * Append the result to a note's `signatures` and serialize it.
 *
 * @throws {LedgerError} `invalid_note` for bad text or name; `invalid_input` when
 *   `privateKey` is not an Ed25519 signing key; `crypto_unavailable` when the
 *   runtime's WebCrypto lacks Ed25519.
 */
export async function signNote(text: string, signer: NoteSigner): Promise<NoteSignature> {
  if (typeof text !== 'string' || !text.endsWith('\n')) invalid('note text must end with a newline')
  checkNoteText(text, 'note text')
  const keyId = await noteKeyId(signer.name, ED25519_TYPE, signer.publicKey)
  let signature: ArrayBuffer
  try {
    signature = await defaultSubtle().sign(
      { name: 'Ed25519' },
      signer.privateKey,
      encoder.encode(text),
    )
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'NotSupportedError') {
      throw new LedgerError('crypto_unavailable', 'this runtime has no WebCrypto Ed25519', {
        cause,
      })
    }
    throw new LedgerError('invalid_input', 'privateKey must be an Ed25519 signing CryptoKey', {
      cause,
    })
  }
  return Object.freeze({ name: signer.name, keyId, signature: new Uint8Array(signature) })
}

/** Outcome of {@link verifyNote}. */
export interface NoteVerification {
  /**
   * `verified`: at least one signature from a known key verified and none
   * failed. `failed`: a known key's signature did not verify (reject the
   * note). `unverified`: no known key signed it, or none could be checked here.
   */
  readonly status: 'verified' | 'failed' | 'unverified'
  readonly verified: readonly NoteSignature[]
  readonly failed: readonly NoteSignature[]
  /** Signatures by keys not in the list — ignored, as the spec requires. */
  readonly unknown: readonly NoteSignature[]
  /** Signatures by known keys this runtime cannot check (non-Ed25519, or no Ed25519 in WebCrypto). */
  readonly unsupported: readonly NoteSignature[]
  readonly reason?: string
}

/** Options for {@link verifyNote} and `verifyCheckpoint`. */
export interface VerifyNoteOptions {
  /** WebCrypto implementation. Default `globalThis.crypto.subtle`. */
  subtle?: SubtleCrypto
}

async function checkEd25519(
  subtle: SubtleCrypto,
  key: VerifierKey,
  sig: NoteSignature,
  text: Uint8Array<ArrayBuffer>,
): Promise<'verified' | 'failed' | 'unsupported'> {
  if (sig.signature.length !== 64) return 'failed'
  let cryptoKey: CryptoKey
  try {
    cryptoKey = await subtle.importKey(
      'raw',
      new Uint8Array(key.publicKey),
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
  } catch {
    return 'unsupported'
  }
  try {
    const ok = await subtle.verify(
      { name: 'Ed25519' },
      cryptoKey,
      new Uint8Array(sig.signature),
      text,
    )
    return ok ? 'verified' : 'failed'
  } catch {
    return 'unsupported'
  }
}

/**
 * Verify a signed note against trusted verifier keys, following C2SP
 * signed-note: signatures from unknown keys (name and key ID not both
 * matching) are ignored; every signature from a known key is checked
 * (Ed25519 via WebCrypto); one failure rejects the note; at least one success
 * is required. When the runtime's WebCrypto has no Ed25519 the result is
 * `unverified` with those signatures listed as `unsupported` — never a false
 * `verified`.
 *
 * @throws {LedgerError} `invalid_note` for an unparseable note or key;
 *   `invalid_input` for duplicate keys (same name and ID).
 */
export async function verifyNote(
  note: SignedNote | string,
  keys: readonly (string | VerifierKey)[],
  opts: VerifyNoteOptions = {},
): Promise<NoteVerification> {
  const parsed = typeof note === 'string' ? parseSignedNote(note) : note
  if (parsed === null || typeof parsed !== 'object' || typeof parsed.text !== 'string') {
    invalid('note must be a string or { text, signatures }')
  }
  checkNoteText(parsed.text, 'note text')
  if (!parsed.text.endsWith('\n')) invalid('note text must end with a newline')
  if (!Array.isArray(parsed.signatures)) invalid('note signatures must be an array')
  if (!Array.isArray(keys)) throw new LedgerError('invalid_input', 'keys must be an array')
  const known = new Map<string, VerifierKey>()
  for (const entry of keys) {
    const key = typeof entry === 'string' ? await parseVerifierKey(entry) : entry
    const id = `${key.name}+${key.keyId}`
    if (known.has(id)) throw new LedgerError('invalid_input', `duplicate verifier key ${key.name}`)
    known.set(id, key)
  }
  const verified: NoteSignature[] = []
  const failed: NoteSignature[] = []
  const unknown: NoteSignature[] = []
  const unsupported: NoteSignature[] = []
  const text = encoder.encode(parsed.text)
  const subtle = opts.subtle ?? defaultSubtle()
  for (const sig of parsed.signatures) {
    const key = known.get(`${sig.name}+${sig.keyId}`)
    if (key === undefined) unknown.push(sig)
    else if (key.type !== ED25519_TYPE) unsupported.push(sig)
    else {
      const outcome = await checkEd25519(subtle, key, sig, text)
      if (outcome === 'verified') verified.push(sig)
      else if (outcome === 'failed') failed.push(sig)
      else unsupported.push(sig)
    }
  }
  const status = failed.length > 0 ? 'failed' : verified.length > 0 ? 'verified' : 'unverified'
  const reason =
    status === 'failed'
      ? 'a signature from a known key did not verify'
      : status === 'unverified'
        ? unsupported.length > 0
          ? 'signatures from known keys cannot be checked in this runtime'
          : 'no signature from a known key'
        : undefined
  return Object.freeze({
    status,
    verified: Object.freeze(verified),
    failed: Object.freeze(failed),
    unknown: Object.freeze(unknown),
    unsupported: Object.freeze(unsupported),
    ...(reason !== undefined && { reason }),
  })
}
