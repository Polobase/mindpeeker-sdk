import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The package must stay browser-safe: no `node:` builtins anywhere under src/.
 * The pure `.` entry has zero bare imports; only the `./oracle` bridge may
 * import a bare specifier, and only the declared `@mindpeeker/oracle` workspace
 * dependency (itself browser-safe).
 */
const ALLOWED_BARE = new Set(['@mindpeeker/oracle'])

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

  test('src/ has no node: builtins and only the whitelisted bare import', () => {
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

  test('only oracle.ts carries the bare dependency import', () => {
    for (const file of tsFiles(srcDir)) {
      const content = readFileSync(file, 'utf8')
      const importsOracle = content.includes("'@mindpeeker/oracle'")
      if (importsOracle) expect(file.endsWith('oracle.ts')).toBe(true)
    }
  })
})
