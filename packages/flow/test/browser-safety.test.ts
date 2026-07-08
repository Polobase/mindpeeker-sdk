import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The whole package must stay browser-safe and zero-dependency: no `node:`
 * builtins and no bare package imports anywhere under src/.
 */
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

  test('src/ has no node: builtins and no bare imports', () => {
    for (const file of tsFiles(srcDir)) {
      const content = readFileSync(file, 'utf8')
      for (const match of content.matchAll(importPattern)) {
        const specifier = match[1] as string
        expect(specifier.startsWith('node:'), `${file} imports ${specifier}`).toBe(false)
        expect(
          specifier.startsWith('./') || specifier.startsWith('../'),
          `${file} imports non-relative ${specifier}`,
        ).toBe(true)
      }
    }
  })
})
