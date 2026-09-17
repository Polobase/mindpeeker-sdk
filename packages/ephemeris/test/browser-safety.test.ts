import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The package must stay browser-safe and zero-dependency: no `node:` builtins
 * and no bare imports anywhere under src/. Imports are read with Bun's parser,
 * so side-effect and dynamic imports are covered too.
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
  const root = join(import.meta.dir, '..')
  const transpiler = new Bun.Transpiler({ loader: 'ts' })

  test('package.json declares no dependencies', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      peerDependencies?: Record<string, string>
    }
    expect(Object.keys(manifest.dependencies ?? {})).toEqual([])
    expect(Object.keys(manifest.peerDependencies ?? {})).toEqual([])
  })

  test('src/ has no node: builtins and only relative imports', () => {
    const files = tsFiles(join(root, 'src'))
    expect(files.length).toBeGreaterThan(10)
    for (const file of files) {
      for (const { path: specifier } of transpiler.scanImports(readFileSync(file, 'utf8'))) {
        expect(specifier.startsWith('node:'), `${file} imports ${specifier}`).toBe(false)
        expect(
          specifier.startsWith('./') || specifier.startsWith('../'),
          `${file} imports non-relative ${specifier}`,
        ).toBe(true)
      }
    }
  })

  test('src/ never reads the wall clock or Math.random', () => {
    for (const file of tsFiles(join(root, 'src'))) {
      const code = readFileSync(file, 'utf8')
      expect(/Math\.random\s*\(|Date\.now\s*\(|performance\.now\s*\(/.test(code), file).toBe(false)
    }
  })
})
