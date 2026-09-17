import { EntropyError } from '../errors.js'
import { hexToBytes } from './bytes.js'
import { pemToDer, spkiFromCertificate } from './x509.js'

/**
 * Opt-in verification of NIST IR 8213 (Beacon 2.0 format) pulses with
 * cipherSuite 0 (SHA-512 + RSASSA-PKCS1-v1_5), WebCrypto only.
 *
 * Serialization — pinned by checked-in live pulses of NIST, NQSN and Inmetro,
 * because the deployed layout deviates from the IR 8213 draft (which prints
 * uint64 length prefixes and a uint64 `external.statusCode`): fields F1…F19 in
 * order, strings (uri, version, timeStamp) as uint32-BE byte length + UTF-8,
 * hash fields (certificateId, localRandomValue, external.sourceId,
 * external.value, previous/hour/day/month/year, precommitmentValue) as
 * uint32-BE length + raw bytes, cipherSuite/period/external.statusCode/
 * statusCode as uint32-BE and chainIndex/pulseIndex as uint64-BE.
 *
 * - `signatureValue` = RSASSA-PKCS1-v1_5/SHA-512 over F1…F19;
 * - `outputValue` = SHA-512(F1…F19 ‖ signature): NIST and NQSN append the raw
 *   signature bytes, Inmetro prefixes its uint32 length (IR 8213 draft) —
 *   both encodings are accepted;
 * - `certificateId` = SHA-512 of the certificate: NIST hashes the DER, NQSN
 *   the PEM text as served — both are accepted.
 *
 * The signature is bound to the certificate the beacon names, not to a CA:
 * no X.509 chain, validity or revocation checking is done.
 */

const LIST_TYPES = ['previous', 'hour', 'day', 'month', 'year'] as const

/** A pulse with every field IR 8213 serializes, validated for type. */
export interface StrictPulse {
  uri: string
  version: string
  cipherSuite: number
  period: number
  certificateId: string
  chainIndex: number
  pulseIndex: number
  timeStamp: string
  localRandomValue: string
  external: { sourceId: string; statusCode: number; value: string }
  listValues: Record<(typeof LIST_TYPES)[number], string>
  precommitmentValue: string
  statusCode: number
  signatureValue: string
  outputValue: string
}

function malformed(field: string, provider: string): EntropyError {
  return new EntropyError('bad_response', `pulse field ${field} is missing or malformed`, {
    provider,
  })
}

function failed(message: string, provider: string, cause?: unknown): EntropyError {
  return new EntropyError('verification', message, { provider, cause })
}

const HEX_RE = /^(?:[0-9a-fA-F]{2})*$/

type Fields = Record<string, unknown>

function str(obj: Fields, key: string, provider: string, hex = false): string {
  const value = obj[key]
  if (typeof value !== 'string' || (hex && !HEX_RE.test(value))) throw malformed(key, provider)
  return value
}

function uint(obj: Fields, key: string, max: number, provider: string): number {
  const value = obj[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) {
    throw malformed(key, provider)
  }
  return value
}

const UINT32_MAX = 0xffff_ffff

/** Validate that a pulse carries every serialized field; `bad_response` otherwise. */
export function parseStrictPulse(raw: unknown, provider: string): StrictPulse {
  if (raw === null || typeof raw !== 'object') throw malformed('pulse', provider)
  const p = raw as Fields
  const external = p.external
  if (external === null || typeof external !== 'object') throw malformed('external', provider)
  const ext = external as Fields
  if (!Array.isArray(p.listValues)) throw malformed('listValues', provider)
  const lists: Partial<Record<(typeof LIST_TYPES)[number], string>> = {}
  for (const entry of p.listValues as unknown[]) {
    if (entry === null || typeof entry !== 'object') throw malformed('listValues', provider)
    const { type, value } = entry as Fields
    if (typeof type !== 'string' || !(LIST_TYPES as readonly string[]).includes(type)) continue
    if (typeof value !== 'string' || !HEX_RE.test(value))
      throw malformed(`listValues.${type}`, provider)
    lists[type as (typeof LIST_TYPES)[number]] = value
  }
  for (const type of LIST_TYPES) {
    if (lists[type] === undefined) throw malformed(`listValues.${type}`, provider)
  }
  return {
    uri: str(p, 'uri', provider),
    version: str(p, 'version', provider),
    cipherSuite: uint(p, 'cipherSuite', UINT32_MAX, provider),
    period: uint(p, 'period', UINT32_MAX, provider),
    certificateId: str(p, 'certificateId', provider, true),
    chainIndex: uint(p, 'chainIndex', Number.MAX_SAFE_INTEGER, provider),
    pulseIndex: uint(p, 'pulseIndex', Number.MAX_SAFE_INTEGER, provider),
    timeStamp: str(p, 'timeStamp', provider),
    localRandomValue: str(p, 'localRandomValue', provider, true),
    external: {
      sourceId: str(ext, 'sourceId', provider, true),
      statusCode: uint(ext, 'statusCode', UINT32_MAX, provider),
      value: str(ext, 'value', provider, true),
    },
    listValues: lists as StrictPulse['listValues'],
    precommitmentValue: str(p, 'precommitmentValue', provider, true),
    statusCode: uint(p, 'statusCode', UINT32_MAX, provider),
    signatureValue: str(p, 'signatureValue', provider, true),
    outputValue: str(p, 'outputValue', provider, true),
  }
}

class ByteWriter {
  readonly #parts: Uint8Array[] = []
  #length = 0

  #push(bytes: Uint8Array): void {
    this.#parts.push(bytes)
    this.#length += bytes.length
  }

  uint32(value: number): void {
    const out = new Uint8Array(4)
    new DataView(out.buffer).setUint32(0, value)
    this.#push(out)
  }

  uint64(value: number): void {
    const out = new Uint8Array(8)
    new DataView(out.buffer).setBigUint64(0, BigInt(value))
    this.#push(out)
  }

  prefixed(bytes: Uint8Array): void {
    this.uint32(bytes.length)
    this.#push(bytes)
  }

  bytes(): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(this.#length)
    let offset = 0
    for (const part of this.#parts) {
      out.set(part, offset)
      offset += part.length
    }
    return out
  }
}

const encoder = new TextEncoder()

/** Byte-serialize fields F1…F19 of a pulse (the signed message). */
export function serializePulseFields(p: StrictPulse): Uint8Array<ArrayBuffer> {
  const w = new ByteWriter()
  const text = (value: string) => w.prefixed(encoder.encode(value))
  const hash = (hex: string) => w.prefixed(hexToBytes(hex))
  text(p.uri)
  text(p.version)
  w.uint32(p.cipherSuite)
  w.uint32(p.period)
  hash(p.certificateId)
  w.uint64(p.chainIndex)
  w.uint64(p.pulseIndex)
  text(p.timeStamp)
  hash(p.localRandomValue)
  hash(p.external.sourceId)
  w.uint32(p.external.statusCode)
  hash(p.external.value)
  for (const type of LIST_TYPES) hash(p.listValues[type])
  hash(p.precommitmentValue)
  w.uint32(p.statusCode)
  return w.bytes()
}

async function sha512(...parts: Uint8Array[]): Promise<Uint8Array> {
  let total = 0
  for (const part of parts) total += part.length
  const joined = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-512', joined))
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] as number) ^ (b[i] as number)
  return diff === 0
}

function lengthPrefix(length: number): Uint8Array {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, length)
  return out
}

/** `outputValue` = SHA-512(F1…F19 ‖ signature), raw or uint32-length-prefixed. */
export async function checkPulseOutput(p: StrictPulse, provider: string): Promise<void> {
  const fields = serializePulseFields(p)
  const signature = hexToBytes(p.signatureValue)
  const output = hexToBytes(p.outputValue)
  if (sameBytes(await sha512(fields, signature), output)) return
  if (sameBytes(await sha512(fields, lengthPrefix(signature.length), signature), output)) return
  throw failed(
    `outputValue of pulse ${p.chainIndex}/${p.pulseIndex} does not match SHA-512 of its fields and signature`,
    provider,
  )
}

/**
 * Import the RSA public key of a PEM certificate after checking that
 * `certificateId` is its SHA-512 (of the DER, or of the PEM text as served).
 */
export async function importPulseCertificate(
  pem: string,
  certificateId: string,
  provider: string,
): Promise<CryptoKey> {
  let der: Uint8Array<ArrayBuffer>
  let spki: Uint8Array<ArrayBuffer>
  try {
    der = pemToDer(pem)
    spki = spkiFromCertificate(der)
  } catch (error) {
    throw failed(
      `certificate ${certificateId.slice(0, 16)}… is not a parseable X.509 PEM`,
      provider,
      error,
    )
  }
  const expected = hexToBytes(certificateId)
  const matches =
    sameBytes(await sha512(der), expected) || sameBytes(await sha512(encoder.encode(pem)), expected)
  if (!matches) {
    throw failed(
      `certificate served for ${certificateId.slice(0, 16)}… does not hash to its certificateId`,
      provider,
    )
  }
  try {
    return await crypto.subtle.importKey(
      'spki',
      spki,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' },
      false,
      ['verify'],
    )
  } catch (error) {
    throw failed('certificate does not hold an RSA public key', provider, error)
  }
}

/** Verify `signatureValue` over F1…F19 with the certificate's key. */
export async function checkPulseSignature(
  p: StrictPulse,
  key: CryptoKey,
  provider: string,
): Promise<void> {
  const signature = hexToBytes(p.signatureValue)
  let valid = false
  try {
    valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, serializePulseFields(p))
  } catch {
    valid = false
  }
  if (!valid) {
    const algorithm = key.algorithm as RsaHashedKeyAlgorithm
    const keyBytes = Math.ceil((algorithm.modulusLength ?? 0) / 8)
    const hint =
      keyBytes > 0 && keyBytes !== signature.length
        ? ` (a ${signature.length}-byte signature cannot come from the certificate's ${algorithm.modulusLength}-bit key)`
        : ''
    throw failed(
      `signatureValue of pulse ${p.chainIndex}/${p.pulseIndex} does not verify against certificate ${p.certificateId.slice(0, 16)}…${hint}`,
      provider,
    )
  }
}

/**
 * Chain linkage of two consecutive pulses of one chain (`later.pulseIndex =
 * earlier.pulseIndex + 1`): `later.previous` = `earlier.outputValue`, and —
 * unless `later` flags a lost local random value (status bit 1) —
 * `earlier.precommitmentValue` = SHA-512(`later.localRandomValue`).
 */
export async function checkPulseLinkage(
  later: StrictPulse,
  earlier: StrictPulse,
  provider: string,
): Promise<void> {
  const where = `pulses ${earlier.chainIndex}/${earlier.pulseIndex} → ${later.pulseIndex}`
  if (!sameBytes(hexToBytes(later.listValues.previous), hexToBytes(earlier.outputValue))) {
    throw failed(`${where}: previous value does not equal the earlier outputValue`, provider)
  }
  if ((later.statusCode & 1) === 0) {
    const commitment = await sha512(hexToBytes(later.localRandomValue))
    if (!sameBytes(commitment, hexToBytes(earlier.precommitmentValue))) {
      throw failed(
        `${where}: precommitmentValue does not equal SHA-512(localRandomValue)`,
        provider,
      )
    }
  }
}
