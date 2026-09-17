import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Read and parse a JSON fixture from test/fixtures. */
export function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(import.meta.dir, '..', 'fixtures', name), 'utf8')) as T
}

/** Read a text fixture from test/fixtures verbatim. */
export function textFixture(name: string): string {
  return readFileSync(join(import.meta.dir, '..', 'fixtures', name), 'utf8')
}

/** Lower-case hex to bytes (test-side, independent of src). */
export function hex(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))
}

/** Standard base64 to bytes via atob (test-side, independent of src). */
export function b64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (ch) => ch.charCodeAt(0))
}

/** Collect an async iterable. */
export async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of source) out.push(item)
  return out
}

/** Flip bits of one byte in place (test helper). */
export function flip(bytes: Uint8Array, index: number, mask = 1): Uint8Array {
  bytes[index] = (bytes[index] as number) ^ mask
  return bytes
}
