import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * src/ must stay browser-safe: no `node:` builtins (side-effect and dynamic
 * imports included — read with Bun's parser), no Node globals, and bare
 * imports only of declared workspace dependencies.
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
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
  }
  const dependencies = Object.keys(manifest.dependencies ?? {})
  const transpiler = new Bun.Transpiler({ loader: 'ts' })
  const files = tsFiles(join(root, 'src'))

  test('declared dependencies are workspace siblings only', () => {
    for (const dep of dependencies) {
      expect(dep.startsWith('@mindpeeker/'), dep).toBe(true)
      expect(manifest.dependencies?.[dep]).toBe('workspace:*')
    }
  })

  test('src/ has no node: builtins and only relative or declared-dependency imports', () => {
    expect(files.length).toBeGreaterThan(15)
    for (const file of files) {
      for (const { path: specifier } of transpiler.scanImports(readFileSync(file, 'utf8'))) {
        expect(specifier.startsWith('node:'), `${file} imports ${specifier}`).toBe(false)
        const relative = specifier.startsWith('./') || specifier.startsWith('../')
        const declared = dependencies.some(
          (dep) => specifier === dep || specifier.startsWith(`${dep}/`),
        )
        expect(relative || declared, `${file} imports undeclared ${specifier}`).toBe(true)
      }
    }
  })

  test('src/ uses no Node globals or nondeterministic sources', () => {
    const forbidden = /\bprocess\.|\bBuffer\b|\brequire\(|\bMath\.random\(|\bDate\.now\(/
    for (const file of files) {
      const code = transpiler.transformSync(readFileSync(file, 'utf8'))
      expect(forbidden.test(code), `${file} uses a forbidden global`).toBe(false)
    }
  })
})
