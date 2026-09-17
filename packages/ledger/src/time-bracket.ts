import { canonicalBytes, canonicalize } from './canonical.js'
import { LedgerError } from './errors.js'
import { isHashHex, sha256Hex } from './hash.js'
import { hexToBytes } from './internal/bytes.js'
import type { BeaconAnchor, NotAfterAnchor, NotAfterKind, TimeBracket } from './types.js'

/** Schema tag of the hashed time-bracket envelope `{ schema, bracket }`. */
export const TIME_BRACKET_SCHEMA = 'mindpeeker-ledger/time-bracket/1'
/** Schema tag of the VDF seal input `{ schema, registrationHash, notBefore }`. */
export const TIME_BRACKET_SEAL_SCHEMA = 'mindpeeker-ledger/time-bracket-seal/1'

const NOT_AFTER_KINDS: readonly NotAfterKind[] = ['ots', 'rekor', 'tlog-checkpoint', 'beacon']
const BEACON_FIELDS: readonly string[] = ['source', 'chain', 'round', 'timestamp', 'valueHex']
const HEX = /^(?:[0-9a-f]{2})+$/
const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/

type Obj = Record<string, unknown>

function fail(path: string, message: string): never {
  throw new LedgerError('invalid_bracket', `${path} ${message}`)
}

function object(value: unknown, path: string, allowed: readonly string[]): Obj {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'must be an object')
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, 'is not a time-bracket field')
  }
  return value as Obj
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(path, 'must be a non-empty string')
  return value
}

function hex(value: unknown, path: string): string {
  if (typeof value !== 'string' || !HEX.test(value)) {
    fail(path, 'must be non-empty, even-length, lower-case hex')
  }
  return value
}

/** Strict ISO 8601 UTC timestamp with a real calendar date; returns epoch ms. */
function timestamp(value: unknown, path: string): number {
  const match = typeof value === 'string' ? ISO.exec(value) : null
  if (match === null) fail(path, 'must be an ISO 8601 UTC timestamp YYYY-MM-DDTHH:MM:SS[.sss]Z')
  const [y, mo, d, h, mi, s] = match.slice(1, 7).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ]
  const ms = Date.UTC(y, mo - 1, d, h, mi, s)
  const back = new Date(ms)
  if (
    back.getUTCFullYear() !== y ||
    back.getUTCMonth() !== mo - 1 ||
    back.getUTCDate() !== d ||
    back.getUTCHours() !== h ||
    back.getUTCMinutes() !== mi ||
    back.getUTCSeconds() !== s
  ) {
    fail(path, 'is not a valid calendar time')
  }
  return ms + (match[7] === undefined ? 0 : Number(match[7].padEnd(3, '0')))
}

function beacon(value: unknown, path: string): BeaconAnchor {
  const b = object(value, path, BEACON_FIELDS)
  if (typeof b.round !== 'number' || !Number.isSafeInteger(b.round) || b.round < 0) {
    fail(`${path}.round`, 'must be a safe integer ≥ 0')
  }
  timestamp(b.timestamp, `${path}.timestamp`)
  return Object.freeze({
    source: text(b.source, `${path}.source`),
    chain: text(b.chain, `${path}.chain`),
    round: b.round,
    timestamp: b.timestamp as string,
    valueHex: hex(b.valueHex, `${path}.valueHex`),
  })
}

/**
 * Validate a time-bracket record and return a normalized, deeply frozen copy.
 * Structure only: `registrationHash` is lower-case hex SHA-256; the beacon has
 * non-empty `source`/`chain`, a safe-integer `round`, a strict ISO 8601 UTC
 * `timestamp` and hex `valueHex`; a seal is `{ kind: 'vdf-pietrzak', bytesHex }`
 * with non-empty hex; `notAfter` is `{ kind: 'ots' | 'rekor' |
 * 'tlog-checkpoint' | 'beacon', ref }`. Unknown fields are rejected.
 *
 * @throws {LedgerError} `invalid_bracket` naming the offending path.
 */
export function validateTimeBracket(value: unknown): TimeBracket {
  const t = object(value, '$', ['registrationHash', 'notBefore', 'seal', 'notAfter'])
  if (!isHashHex(t.registrationHash)) {
    fail('$.registrationHash', 'must be a lower-case hex SHA-256 (64 digits)')
  }
  const notBefore = object(t.notBefore, '$.notBefore', ['beacon'])
  let seal: TimeBracket['seal']
  if (t.seal !== undefined) {
    const s = object(t.seal, '$.seal', ['kind', 'bytesHex'])
    if (s.kind !== 'vdf-pietrzak') fail('$.seal.kind', "must be 'vdf-pietrzak'")
    seal = Object.freeze({ kind: s.kind, bytesHex: hex(s.bytesHex, '$.seal.bytesHex') })
  }
  let notAfter: NotAfterAnchor | undefined
  if (t.notAfter !== undefined) {
    const n = object(t.notAfter, '$.notAfter', ['kind', 'ref'])
    if (!NOT_AFTER_KINDS.includes(n.kind as NotAfterKind)) {
      fail('$.notAfter.kind', `must be one of ${NOT_AFTER_KINDS.join(' | ')}`)
    }
    notAfter = Object.freeze({ kind: n.kind as NotAfterKind, ref: text(n.ref, '$.notAfter.ref') })
  }
  return Object.freeze({
    registrationHash: t.registrationHash,
    notBefore: Object.freeze({ beacon: beacon(notBefore.beacon, '$.notBefore.beacon') }),
    ...(seal !== undefined && { seal }),
    ...(notAfter !== undefined && { notAfter }),
  })
}

/**
 * The bytes a VDF seals for a bracket: UTF-8 canonical JSON of
 * `{ schema: TIME_BRACKET_SEAL_SCHEMA, registrationHash, notBefore }`. Seal
 * them with `@mindpeeker/vdf` — `sealToBytes(await sealBeacon(input, T), input)`
 * — and store the hex as `seal.bytesHex`. The seal cannot cover itself or a
 * later `notAfter` witness, so neither is part of the input.
 *
 * @throws {LedgerError} `invalid_bracket` for an invalid record.
 */
export function timeBracketSealInput(bracket: TimeBracket): Uint8Array {
  const valid = validateTimeBracket(bracket)
  return canonicalBytes({
    schema: TIME_BRACKET_SEAL_SCHEMA,
    registrationHash: valid.registrationHash,
    notBefore: valid.notBefore,
  })
}

/** Lower-case hex SHA-256 of the canonical JSON of `{ schema: TIME_BRACKET_SCHEMA, bracket }`. */
export async function timeBracketHash(bracket: TimeBracket): Promise<string> {
  return sha256Hex(
    canonicalize({ schema: TIME_BRACKET_SCHEMA, bracket: validateTimeBracket(bracket) }),
  )
}

/** Caller-supplied verifier of a VDF seal — `verifySealBytes` from `@mindpeeker/vdf` fits. */
export type SealVerifier = (input: Uint8Array, sealBytes: Uint8Array) => Promise<boolean> | boolean

/** Caller-supplied check of a no-later-than witness (e.g. an OTS or checkpoint verifier). */
export type NotAfterVerifier = (
  anchor: NotAfterAnchor,
  bracket: TimeBracket,
) => Promise<boolean> | boolean

/** Options for {@link verifyTimeBracket}. */
export interface VerifyTimeBracketOptions {
  /** The registration hash the bracket must cover (compute it yourself from the published registration). */
  registrationHash?: string
  /** Lowest acceptable beacon round, e.g. the round due after the registration was drafted. */
  minRound?: number
  /** Beacon fields fetched independently (entropy `getRound`); each given field must match. */
  beacon?: Partial<BeaconAnchor>
  /** Verify the VDF seal. Without it a present seal is reported `unverified`. */
  verifySeal?: SealVerifier
  /** Fail when there is no seal. */
  requireSeal?: boolean
  /** Verify the no-later-than witness. Without it a present witness is `unverified`. */
  verifyNotAfter?: NotAfterVerifier
  /** Fail when there is no no-later-than witness. */
  requireNotAfter?: boolean
}

/** Check outcome of one optional piece of evidence. */
export type EvidenceStatus = 'verified' | 'failed' | 'unverified' | 'absent'

/** The result of {@link verifyTimeBracket}. */
export interface TimeBracketVerification {
  /** True iff the record is well-formed and every check that ran passed (including `require*`). */
  readonly ok: boolean
  /** `invalid` when the record fails {@link validateTimeBracket}; no other checks run then. */
  readonly structure: 'valid' | 'invalid'
  readonly registration: 'match' | 'mismatch' | 'unchecked'
  /** `ok`: round ≥ `minRound` and every supplied beacon field matches; `unchecked` without options. */
  readonly beacon: 'ok' | 'mismatch' | 'unchecked'
  readonly seal: EvidenceStatus
  readonly notAfter: EvidenceStatus
  /** The no-earlier-than bound claimed by the beacon (its timestamp), when structurally valid. */
  readonly notBeforeTime?: string
  readonly issues: readonly string[]
}

async function runHook(hook: () => Promise<boolean> | boolean): Promise<boolean | Error> {
  try {
    return (await hook()) === true
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error))
  }
}

function checkOptions(opts: VerifyTimeBracketOptions): void {
  if (opts === null || typeof opts !== 'object') {
    throw new LedgerError('invalid_input', 'verifyTimeBracket options must be an object')
  }
  if (opts.registrationHash !== undefined && !isHashHex(opts.registrationHash)) {
    throw new LedgerError('invalid_input', 'registrationHash must be a lower-case hex SHA-256')
  }
  if (opts.minRound !== undefined && (!Number.isSafeInteger(opts.minRound) || opts.minRound < 0)) {
    throw new LedgerError('invalid_input', 'minRound must be a safe integer ≥ 0')
  }
  for (const key of ['verifySeal', 'verifyNotAfter'] as const) {
    if (opts[key] !== undefined && typeof opts[key] !== 'function') {
      throw new LedgerError('invalid_input', `${key} must be a function`)
    }
  }
  if (opts.beacon !== undefined) {
    if (opts.beacon === null || typeof opts.beacon !== 'object') {
      throw new LedgerError('invalid_input', 'beacon must be an object of expected fields')
    }
    for (const key of Object.keys(opts.beacon)) {
      if (!BEACON_FIELDS.includes(key)) {
        throw new LedgerError('invalid_input', `beacon has no field ${key}`)
      }
    }
  }
}

/**
 * Check a time bracket without any network access. Structure is validated;
 * `registrationHash` is compared when given; the beacon round is checked
 * against `minRound` and against independently fetched `beacon` fields; the
 * seal and the no-later-than witness are verified only through the hooks you
 * pass (`verifySeal: verifySealBytes` from `@mindpeeker/vdf`), otherwise
 * reported `unverified`.
 *
 * What an `ok` bracket supports — and only under its assumptions:
 * - **not before**: the registration hash was bound to beacon data that did
 *   not exist before the beacon's `timestamp`, *if* the beacon value is
 *   genuine (pass `beacon` fetched yourself) and was unpredictable.
 * - **seal**: whoever produced the seal spent ≈ T sequential squarings after
 *   the seal input was fixed. A VDF gives a *no-earlier-than* bound only; it
 *   never shows when anything was finished.
 * - **not after**: only an external witness (OpenTimestamps, Rekor, a signed
 *   tlog checkpoint, a later beacon that committed to the hash) bounds the
 *   registration from above, with that witness's own trust model.
 *
 * Never throws for content problems; they are listed in `issues`.
 *
 * @throws {LedgerError} `invalid_input` for malformed options.
 */
export async function verifyTimeBracket(
  bracket: TimeBracket,
  opts: VerifyTimeBracketOptions = {},
): Promise<TimeBracketVerification> {
  checkOptions(opts)
  let valid: TimeBracket
  try {
    valid = validateTimeBracket(bracket)
  } catch (error) {
    return Object.freeze({
      ok: false,
      structure: 'invalid',
      registration: 'unchecked',
      beacon: 'unchecked',
      seal: 'unverified',
      notAfter: 'unverified',
      issues: Object.freeze([(error as Error).message]),
    })
  }
  const issues: string[] = []
  let registration: TimeBracketVerification['registration'] = 'unchecked'
  if (opts.registrationHash !== undefined) {
    registration = valid.registrationHash === opts.registrationHash ? 'match' : 'mismatch'
    if (registration === 'mismatch') issues.push('registrationHash does not match')
  }
  const b = valid.notBefore.beacon
  let beaconStatus: TimeBracketVerification['beacon'] = 'unchecked'
  if (opts.minRound !== undefined || opts.beacon !== undefined) {
    beaconStatus = 'ok'
    if (opts.minRound !== undefined && b.round < opts.minRound) {
      beaconStatus = 'mismatch'
      issues.push(`beacon round ${b.round} is below the required ${opts.minRound}`)
    }
    for (const [key, expected] of Object.entries(opts.beacon ?? {})) {
      if (expected !== undefined && b[key as keyof BeaconAnchor] !== expected) {
        beaconStatus = 'mismatch'
        issues.push(`beacon ${key} does not match the independently fetched value`)
      }
    }
  }
  let seal: EvidenceStatus = valid.seal === undefined ? 'absent' : 'unverified'
  if (valid.seal !== undefined && opts.verifySeal !== undefined) {
    const verify = opts.verifySeal
    const bytes = hexToBytes(valid.seal.bytesHex, 'seal.bytesHex')
    const outcome = await runHook(() => verify(timeBracketSealInput(valid), bytes))
    seal = outcome === true ? 'verified' : 'failed'
    if (outcome !== true) {
      issues.push(
        outcome instanceof Error
          ? `seal verifier threw: ${outcome.message}`
          : 'seal does not verify',
      )
    }
  }
  if (seal === 'absent' && opts.requireSeal === true) issues.push('a VDF seal is required')
  let notAfter: EvidenceStatus = valid.notAfter === undefined ? 'absent' : 'unverified'
  if (valid.notAfter !== undefined && opts.verifyNotAfter !== undefined) {
    const verify = opts.verifyNotAfter
    const anchor = valid.notAfter
    const outcome = await runHook(() => verify(anchor, valid))
    notAfter = outcome === true ? 'verified' : 'failed'
    if (outcome !== true) {
      issues.push(
        outcome instanceof Error
          ? `notAfter verifier threw: ${outcome.message}`
          : 'notAfter witness does not verify',
      )
    }
  }
  if (notAfter === 'absent' && opts.requireNotAfter === true) {
    issues.push('a no-later-than witness is required')
  }
  return Object.freeze({
    ok: issues.length === 0,
    structure: 'valid',
    registration,
    beacon: beaconStatus,
    seal,
    notAfter,
    notBeforeTime: b.timestamp,
    issues: Object.freeze(issues),
  })
}
