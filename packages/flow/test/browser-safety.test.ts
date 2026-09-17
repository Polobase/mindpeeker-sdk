import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The whole package must stay browser-safe: no `node:` builtins anywhere
 * under src/, and bare imports only of declared workspace dependencies
 * (`@mindpeeker/negentropy/numerics`). Imports are read with Bun's parser, so
 * side-effect and dynamic imports are covered too.
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

  test('declared dependencies are workspace siblings only', () => {
    for (const dep of dependencies) {
      expect(dep.startsWith('@mindpeeker/'), dep).toBe(true)
      expect(manifest.dependencies?.[dep]).toBe('workspace:*')
    }
  })

  test('src/ has no node: builtins and only relative or declared-dependency imports', () => {
    const files = tsFiles(join(root, 'src'))
    expect(files.length).toBeGreaterThan(10)
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

  test('the negentropy dependency is used only through its ./numerics subpath', () => {
    for (const file of tsFiles(join(root, 'src'))) {
      for (const { path: specifier } of transpiler.scanImports(readFileSync(file, 'utf8'))) {
        if (specifier.startsWith('@mindpeeker/negentropy')) {
          expect(specifier, file).toBe('@mindpeeker/negentropy/numerics')
        }
      }
    }
  })
})
