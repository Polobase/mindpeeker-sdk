import { LedgerError } from './errors.js'

/** Deepest nesting of arrays/objects accepted by {@link canonicalize}. */
export const MAX_JSON_DEPTH = 512

function reject(path: string, what: string): never {
  throw new LedgerError(
    'invalid_json',
    `canonicalize: ${path} is ${what} — not canonical JSON (convert it explicitly)`,
  )
}

/** RFC 7493 (I-JSON) §2.1: no lone surrogates, no Unicode noncharacters. */
function checkString(value: string, path: string): void {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i)
    let codePoint = unit
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) reject(path, 'a string with a lone surrogate')
      codePoint = 0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00)
      i++
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      reject(path, 'a string with a lone surrogate')
    }
    if ((codePoint >= 0xfdd0 && codePoint <= 0xfdef) || (codePoint & 0xfffe) === 0xfffe) {
      reject(path, 'a string with a Unicode noncharacter')
    }
  }
}

function serialize(value: unknown, path: string, stack: object[]): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) reject(path, `the non-finite number ${value}`)
      // ECMAScript Number::toString (RFC 8785 §3.2.2.3); JSON.stringify(-0) is "0"
      return JSON.stringify(value)
    case 'string':
      checkString(value, path)
      // ECMAScript QuoteJSONString = RFC 8785 §3.2.2.2 for well-formed strings
      return JSON.stringify(value)
    case 'object': {
      if (stack.includes(value)) reject(path, 'a circular reference')
      if (stack.length >= MAX_JSON_DEPTH) reject(path, `nested deeper than ${MAX_JSON_DEPTH}`)
      if (Array.isArray(value)) {
        stack.push(value)
        const items: string[] = []
        for (let i = 0; i < value.length; i++) {
          if (!(i in value)) reject(`${path}[${i}]`, 'an array hole')
          if (value[i] === undefined) reject(`${path}[${i}]`, 'undefined')
          items.push(serialize(value[i], `${path}[${i}]`, stack))
        }
        stack.pop()
        return `[${items.join(',')}]`
      }
      const proto: unknown = Object.getPrototypeOf(value)
      if (proto !== Object.prototype && proto !== null) {
        const name = (value as { constructor?: { name?: string } }).constructor?.name ?? 'object'
        reject(path, `a ${name}`)
      }
      stack.push(value)
      const record = value as Record<string, unknown>
      const members = Object.keys(record)
        // Default sort compares UTF-16 code units as unsigned integers (RFC 8785 §3.2.3)
        .sort()
        .map((key) => {
          const child = `${path}.${key}`
          checkString(key, child)
          if (record[key] === undefined) reject(child, 'undefined')
          return `${JSON.stringify(key)}:${serialize(record[key], child, stack)}`
        })
      stack.pop()
      return `{${members.join(',')}}`
    }
    default:
      return reject(path, `a ${typeof value}`)
  }
}

/**
 * RFC 8785 JSON Canonicalization Scheme (JCS): object members sorted by
 * UTF-16 code units, numbers in ECMAScript shortest round-trip form
 * (`-0` → `0`, `1e+21`, `1e-7`), strings escaped exactly as ECMAScript
 * `JSON.stringify` does, no insignificant whitespace. Hash the UTF-8 bytes of
 * the result ({@link canonicalBytes}).
 *
 * Input must be I-JSON (RFC 7493), so anything JSON cannot represent
 * losslessly is **rejected**, never coerced: NaN/±Infinity; `undefined` (also
 * as an object member or array element) and array holes; BigInt, functions,
 * symbols; strings with lone surrogates or Unicode noncharacters; cycles;
 * nesting deeper than {@link MAX_JSON_DEPTH}; and every non-plain object —
 * Date, Map, Set, RegExp, typed arrays, class instances (`toJSON` is never
 * called). Convert those explicitly first (a Date via `toISOString()`, bytes
 * via hex, a BigInt via its decimal string).
 *
 * The output is byte-identical to `canonicalJson` in `@mindpeeker/negentropy`
 * for every value both accept, so registration digests agree across packages.
 *
 * @throws {LedgerError} `invalid_json` naming the path of the first offending value.
 */
export function canonicalize(value: unknown): string {
  return serialize(value, '$', [])
}

/** UTF-8 bytes of {@link canonicalize}`(value)` — the RFC 8785 §3.2.4 output. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value))
}
