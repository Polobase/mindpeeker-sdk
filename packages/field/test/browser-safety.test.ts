import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** src/ must stay browser-safe: no `node:` builtins, only relative or @mindpeeker imports. */
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
  test('no node: builtins under src/', () => {
    const srcDir = join(import.meta.dir, '..', 'src')
    const pattern = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g
    for (const file of tsFiles(srcDir)) {
      const content = readFileSync(file, 'utf8')
      for (const match of content.matchAll(pattern)) {
        const specifier = match[1] as string
        expect(specifier.startsWith('node:'), `${file} imports ${specifier}`).toBe(false)
      }
    }
  })
})
