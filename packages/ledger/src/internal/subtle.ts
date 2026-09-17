import { LedgerError } from '../errors.js'

/** The runtime's WebCrypto `SubtleCrypto`, or `crypto_unavailable`. */
export function defaultSubtle(): SubtleCrypto {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle
  if (subtle === undefined) {
    throw new LedgerError(
      'crypto_unavailable',
      'WebCrypto crypto.subtle is not available (browsers need a secure context)',
    )
  }
  return subtle
}

/** SHA-256 of bytes through WebCrypto. */
export async function digest256(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await defaultSubtle().digest('SHA-256', bytes))
}
