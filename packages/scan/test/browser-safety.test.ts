import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The package must stay browser-safe: no `node:` builtins anywhere under
 * src/, and the only bare imports allowed are the declared workspace
 * dependencies (each itself browser-safe) and negentropy's `/numerics` subpath.
 */
const ALLOWED_BARE = new Set([
  '@mindpeeker/oracle',
  '@mindpeeker/rate',
  '@mindpeeker/psi',
  '@mindpeeker/negentropy',
  '@mindpeeker/negentropy/numerics',
])

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...tsFiles(path))
    else if (entry.name.endsWith('.ts')) out.push(path)
  }
  return out
}

describe('browser safety', () => {
  const srcDir = join(import.meta.dir, '..', 'src')
  const importPattern = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g

  test('src/ has no node: builtins and only whitelisted bare imports', () => {
    for (const file of tsFiles(srcDir)) {
      const content = readFileSync(file, 'utf8')
      for (const match of content.matchAll(importPattern)) {
        const specifier = match[1] as string
        expect(specifier.startsWith('node:'), `${file} imports ${specifier}`).toBe(false)
        expect(
          specifier.startsWith('./') || specifier.startsWith('../') || ALLOWED_BARE.has(specifier),
          `${file} imports non-whitelisted ${specifier}`,
        ).toBe(true)
      }
    }
  })

  test('the scan-core files carry no modulo selection path', () => {
    for (const name of ['scan/race.ts', 'scan/deviation.ts', 'scan/vitality.ts', 'scan/scan.ts']) {
      const content = readFileSync(join(srcDir, name), 'utf8')
      expect(content.includes('uniformInt'), `${name} must draw via uniformInt`).toBe(true)
      // A biased `x % n` selection is exactly what the SDK port removes; these
      // files must contain no `%` at all (all randomness goes through oracle).
      expect(content.includes('%'), `${name} must not use modulo`).toBe(false)
    }
  })
})
