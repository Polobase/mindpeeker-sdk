import { canonicalJson } from '@mindpeeker/negentropy'
import { PsiError } from '../errors.js'

/**
 * Canonical JSON via negentropy's `canonicalJson` (recursively key-sorted, no
 * insignificant whitespace, `undefined` members dropped, non-finite numbers
 * rejected), with its errors mapped to `PsiError('invalid_plan')`.
 */
export function canonical(value: unknown, what: string): string {
  try {
    return canonicalJson(value)
  } catch (error) {
    throw new PsiError('invalid_plan', `${what} is not canonically serializable`, { cause: error })
  }
}

/** Lower-case hex SHA-256 of the UTF-8 bytes of `text` (Web Crypto — browser-safe). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  let hex = ''
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/** Recursively freeze a plain JSON-like value (arrays and objects). */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}
