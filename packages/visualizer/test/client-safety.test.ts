import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * This package is Bun-only on the SERVER (src/server, src/cli use Bun.serve
 * et al. by design), so the usual whole-package browser-safety test does not
 * apply. What MUST stay browser-safe is everything the client bundle can
 * reach: all of client/ plus the shared pure modules it imports from src/.
 * No `node:`/`bun` builtins, no bare package imports, no reaching into the
 * server directory.
 */
const SHARED_SRC = ['protocol.ts', 'types.ts', 'errors.ts']

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...tsFiles(path))
    else if (entry.name.endsWith('.ts')) out.push(path)
  }
  return out
}

describe('client browser safety', () => {
  const clientDir = join(import.meta.dir, '..', 'client')
  const srcDir = join(import.meta.dir, '..', 'src')
  const importPattern = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g
  const files = [...tsFiles(clientDir), ...SHARED_SRC.map((name) => join(srcDir, name))]

  test('client-reachable modules have no node:/bun builtins and no bare imports', () => {
    expect(files.length).toBeGreaterThan(SHARED_SRC.length)
    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      for (const match of content.matchAll(importPattern)) {
        const specifier = match[1] as string
        expect(specifier.startsWith('node:'), `${file} imports ${specifier}`).toBe(false)
        expect(
          specifier === 'bun' || specifier.startsWith('bun:'),
          `${file} imports ${specifier}`,
        ).toBe(false)
        expect(
          specifier.startsWith('./') || specifier.startsWith('../'),
          `${file} imports non-relative ${specifier}`,
        ).toBe(true)
        expect(specifier.includes('/server/'), `${file} imports server code: ${specifier}`).toBe(
          false,
        )
      }
    }
  })

  test('shared protocol/types/errors never import the server', () => {
    for (const name of SHARED_SRC) {
      const content = readFileSync(join(srcDir, name), 'utf8')
      expect(content.includes('Bun.'), `${name} references the Bun global`).toBe(false)
    }
  })
})
