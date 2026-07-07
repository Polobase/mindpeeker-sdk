import { EntropyError } from '../errors.js'
import { hexToBytes } from './bytes.js'

/** Validate a provider's JSON number array as exactly `expected` bytes. */
export function byteArrayFrom(values: unknown, expected: number, provider: string): Uint8Array {
  if (!Array.isArray(values) || values.length !== expected) {
    throw new EntropyError(
      'bad_response',
      `expected an array of ${expected} byte values, got ${Array.isArray(values) ? values.length : typeof values}`,
      { provider },
    )
  }
  const out = new Uint8Array(expected)
  for (let i = 0; i < expected; i++) {
    const value = values[i]
    if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 255) {
      throw new EntropyError('bad_response', `value at index ${i} is not a byte: ${value}`, {
        provider,
      })
    }
    out[i] = value as number
  }
  return out
}

/** Validate a provider's hex string field as exactly `expected` bytes. */
export function bytesFromHexField(hex: unknown, expected: number, provider: string): Uint8Array {
  if (typeof hex !== 'string') {
    throw new EntropyError('bad_response', `expected a hex string, got ${typeof hex}`, { provider })
  }
  let bytes: Uint8Array
  try {
    bytes = hexToBytes(hex)
  } catch (error) {
    throw new EntropyError('bad_response', `invalid hex in response`, { provider, cause: error })
  }
  if (bytes.length !== expected) {
    throw new EntropyError('bad_response', `expected ${expected} bytes, got ${bytes.length}`, {
      provider,
    })
  }
  return bytes
}
