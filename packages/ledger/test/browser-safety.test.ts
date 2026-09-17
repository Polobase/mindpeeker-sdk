import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The package must stay browser-safe and dependency-free: no `node:` builtins
 * and no bare imports under src/ (only relative ones), and no Math.random or
 * Date.now in library logic.
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

  test('src/ imports only relative modules (every import found by the transpiler)', () => {
    const transpiler = new Bun.Transpiler({ loader: 'ts' })
    for (const file of tsFiles(srcDir)) {
      for (const { path } of transpiler.scanImports(readFileSync(file, 'utf8'))) {
        expect(path.startsWith('node:'), `${file} imports ${path}`).toBe(false)
        expect(path.startsWith('./') || path.startsWith('../'), `${file} imports ${path}`).toBe(
          true,
        )
      }
    }
  })

  test('no ambient randomness or wall clock in src/', () => {
    for (const file of tsFiles(srcDir)) {
      const content = readFileSync(file, 'utf8')
      expect(/Math\.random|Date\.now|performance\.now/.test(content), file).toBe(false)
    }
  })

  test('package.json declares no dependencies', async () => {
    const pkg = (await Bun.file(join(import.meta.dir, '..', 'package.json')).json()) as Record<
      string,
      unknown
    >
    expect(pkg.dependencies).toBeUndefined()
    expect(pkg.peerDependencies).toBeUndefined()
  })
})
