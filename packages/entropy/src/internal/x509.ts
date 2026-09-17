/**
 * Minimal, dependency-free X.509 handling for beacon certificates: PEM → DER
 * and extraction of the SubjectPublicKeyInfo that WebCrypto imports. No chain
 * or validity checking — a beacon signature is only bound to the certificate
 * the beacon itself names (RFC 5280 §4.1 layout).
 */

interface Tlv {
  tag: number
  /** Offset of the first byte of the TLV (the tag). */
  start: number
  /** Offset of the first value byte. */
  valueStart: number
  /** Offset just past the value. */
  end: number
}

function readTlv(der: Uint8Array, offset: number, limit: number): Tlv {
  if (offset + 2 > limit) throw new TypeError('truncated DER element')
  const tag = der[offset] as number
  let length = der[offset + 1] as number
  let valueStart = offset + 2
  if (length & 0x80) {
    const lengthBytes = length & 0x7f
    if (lengthBytes === 0 || lengthBytes > 4) throw new TypeError('unsupported DER length')
    if (valueStart + lengthBytes > limit) throw new TypeError('truncated DER length')
    length = 0
    for (let i = 0; i < lengthBytes; i++) length = length * 256 + (der[valueStart + i] as number)
    valueStart += lengthBytes
  }
  const end = valueStart + length
  if (end > limit) throw new TypeError('DER element overruns its container')
  return { tag, start: offset, valueStart, end }
}

function expectTag(tlv: Tlv, tag: number, what: string): Tlv {
  if (tlv.tag !== tag) {
    throw new TypeError(
      `expected ${what} (tag 0x${tag.toString(16)}), got 0x${tlv.tag.toString(16)}`,
    )
  }
  return tlv
}

/**
 * Decode the first `CERTIFICATE` block of a PEM text to DER bytes. Tolerates
 * CRLF line endings and trailing whitespace on the armor lines.
 */
export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const match = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/.exec(pem)
  if (!match) throw new TypeError('no PEM CERTIFICATE block found')
  const body = (match[1] ?? '').replace(/\s+/g, '')
  let binary: string
  try {
    binary = atob(body)
  } catch (error) {
    throw new TypeError(`invalid base64 in PEM certificate: ${(error as Error).message}`)
  }
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < out.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * The DER-encoded SubjectPublicKeyInfo of an X.509 certificate:
 * `Certificate → tbsCertificate → [version], serialNumber, signature, issuer,
 * validity, subject, subjectPublicKeyInfo`. Throws `TypeError` on malformed
 * input.
 */
export function spkiFromCertificate(der: Uint8Array): Uint8Array<ArrayBuffer> {
  const certificate = expectTag(readTlv(der, 0, der.length), 0x30, 'Certificate SEQUENCE')
  const tbs = expectTag(
    readTlv(der, certificate.valueStart, certificate.end),
    0x30,
    'tbsCertificate SEQUENCE',
  )
  let cursor = tbs.valueStart
  let element = readTlv(der, cursor, tbs.end)
  if (element.tag === 0xa0) {
    cursor = element.end // explicit [0] version
    element = readTlv(der, cursor, tbs.end)
  }
  expectTag(element, 0x02, 'serialNumber INTEGER')
  cursor = element.end
  for (const what of ['signature AlgorithmIdentifier', 'issuer Name', 'validity', 'subject Name']) {
    element = expectTag(readTlv(der, cursor, tbs.end), 0x30, what)
    cursor = element.end
  }
  const spki = expectTag(readTlv(der, cursor, tbs.end), 0x30, 'subjectPublicKeyInfo SEQUENCE')
  return der.slice(spki.start, spki.end)
}
