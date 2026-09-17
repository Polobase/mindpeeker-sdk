import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SEPHER_SEPHIROTH } from '../src/lexicon.js'

const PKG = join(import.meta.dir, '..')

/**
 * Bundle an in-memory entry (a virtual module resolved by a plugin) with
 * minification and tree shaking, then evaluate the IIFE and return what it logged.
 * The entry imports the package's source files by absolute path, so Bun's
 * resolver applies this package's `sideEffects` field to them — with
 * `"sideEffects": false` the bare lexicon import below is dropped and the bundle
 * throws "no lexicon supplied".
 */
async function bundleAndRun(code: string): Promise<{ logs: unknown[]; text: string }> {
  const result = await Bun.build({
    entrypoints: ['virtual:entry'],
    minify: true,
    format: 'iife',
    target: 'browser',
    plugins: [
      {
        name: 'virtual-entry',
        setup(build) {
          build.onResolve({ filter: /^virtual:entry$/ }, () => ({
            path: 'entry.ts',
            namespace: 'virtual',
          }))
          build.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({
            contents: code,
            loader: 'ts',
          }))
        },
      },
    ],
  })
  expect(result.success).toBe(true)
  const output = result.outputs[0]
  if (!output) throw new Error('no bundle output')
  const text = await output.text()
  const logs: unknown[] = []
  const run = new Function('console', text) as (console: { log: (v: unknown) => void }) => void
  run({ log: (v) => logs.push(v) })
  return { logs, text }
}

describe('bundling the lexicon subpath', () => {
  test('package.json declares the lexicon module as the only side effect', () => {
    const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')) as {
      sideEffects: unknown
    }
    expect(pkg.sideEffects).toEqual(['./dist/lexicon.js', './src/lexicon.ts'])
  })

  test("a bare import '…/lexicon' survives minified tree shaking and registers the default", async () => {
    const { logs } = await bundleAndRun(
      [
        `import '${PKG}/src/lexicon.ts'`,
        `import { getDefaultLexicon, lookup } from '${PKG}/src/index.ts'`,
        'console.log(getDefaultLexicon().length)',
        "console.log(lookup(93, 'gr-isopsephy').matches.join(','))",
      ].join('\n'),
    )
    expect(logs).toEqual([SEPHER_SEPHIROTH.length, 'Αγαπη,Θελημα'])
  })

  test('the root entry alone does not pull the lexicon data in', async () => {
    const root = await bundleAndRun(
      [
        `import { value } from '${PKG}/src/index.ts'`,
        "console.log(value('אחד', 'he-hechrachi'))",
      ].join('\n'),
    )
    expect(root.logs).toEqual([13])
    expect(root.text.includes('באבאלען')).toBe(false)
    const lexicon = await bundleAndRun(`import '${PKG}/src/lexicon.ts'\nconsole.log(1)`)
    expect(lexicon.text.includes('באבאלען')).toBe(true)
  })
})
