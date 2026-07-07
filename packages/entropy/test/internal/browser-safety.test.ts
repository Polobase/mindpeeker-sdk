import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/**
 * The root entry must stay browser-safe: no `node:` import and no file under
 * src/node/ may be reachable from src/index.ts. Node-only capability ships
 * exclusively via the '@mindpeeker/entropy/node' subpath.
 */
describe('browser safety of the root entry', () => {
  test('src/index.ts never reaches node: specifiers or src/node files', () => {
    const srcDir = resolve(import.meta.dir, '../../src')
    const seen = new Set<string>()
    const queue = [join(srcDir, 'index.ts')]
    while (queue.length > 0) {
      const file = queue.pop() as string
      if (seen.has(file)) continue
      seen.add(file)
      expect(file.includes('/src/node/')).toBe(false)
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/from\s+'([^']+)'/g)) {
        const specifier = match[1] as string
        expect(specifier.startsWith('node:')).toBe(false)
        if (specifier.startsWith('.')) {
          queue.push(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')))
        }
      }
    }
    // sanity: the walk actually covered the library
    expect(seen.size).toBeGreaterThan(15)
  })
})
