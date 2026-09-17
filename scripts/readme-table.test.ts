import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  collectPackages,
  computeCounts,
  type Dependency,
  dependencyNotes,
  firstSentence,
  generateReadme,
  moduleSpecifiers,
  ROOT,
  renderGraph,
  renderTable,
  replaceBlock,
} from './readme-table.js'

const plain = (s: string) => s

describe('moduleSpecifiers', () => {
  test('finds static, type-only, re-export, dynamic, side-effect and import-type specifiers', () => {
    const code = [
      "import { a } from '@mindpeeker/a'",
      "import type { B } from '@mindpeeker/b/sub'",
      "export { c } from './c.js'",
      "export type { D } from '@mindpeeker/d'",
      "import '@mindpeeker/e'",
      "const f = await import('@mindpeeker/f')",
      "type G = import('@mindpeeker/g').G",
    ].join('\n')
    expect(moduleSpecifiers(code)).toEqual([
      '@mindpeeker/a',
      '@mindpeeker/b/sub',
      './c.js',
      '@mindpeeker/d',
      '@mindpeeker/e',
      '@mindpeeker/f',
      '@mindpeeker/g',
    ])
  })

  test('ignores comments, strings, templates and regular expressions', () => {
    const code = [
      "// import x from '@mindpeeker/x'",
      "/* import y from '@mindpeeker/y' */",
      'const s = "import z from \'@mindpeeker/z\'"',
      "const t = `import w from '@mindpeeker/w'`",
      "const r = /import q from '@mindpeeker\\/q'/",
    ].join('\n')
    expect(moduleSpecifiers(code)).toEqual([])
  })
})

describe('dependencyNotes', () => {
  const dep = (over: Partial<Dependency>): Dependency => ({
    dir: 'negentropy',
    subpaths: ['.'],
    onlyFrom: null,
    ...over,
  })

  test('a root import used by every entry point needs no note', () => {
    expect(dependencyNotes(dep({}), plain)).toEqual([])
  })

  test('subpaths and entry restrictions are spelled out', () => {
    expect(dependencyNotes(dep({ subpaths: ['.', './numerics'] }), plain)).toEqual([
      'root, ./numerics',
    ])
    expect(dependencyNotes(dep({ onlyFrom: ['./oracle'] }), plain)).toEqual(['only from ./oracle'])
    expect(dependencyNotes(dep({ onlyFrom: ['.'] }), plain)).toEqual(['only from the root entry'])
    expect(
      dependencyNotes(dep({ subpaths: ['./numerics'], onlyFrom: ['bin:viz'] }), plain),
    ).toEqual(['./numerics', 'only from the viz CLI'])
  })

  test('a declared dependency that no source imports is flagged', () => {
    expect(dependencyNotes(dep({ subpaths: [], onlyFrom: [] }), plain)).toEqual([
      'declared, not imported',
      'no entry point',
    ])
  })
})

describe('replaceBlock', () => {
  const doc = [
    'intro',
    '<!-- BEGIN generated:t (bun run readme:table) -->',
    'old',
    '<!-- END generated:t -->',
    'outro',
  ].join('\n')

  test('replaces only the lines between the markers', () => {
    expect(replaceBlock(doc, 't', 'new\nrows')).toBe(
      [
        'intro',
        '<!-- BEGIN generated:t (bun run readme:table) -->',
        'new',
        'rows',
        '<!-- END generated:t -->',
        'outro',
      ].join('\n'),
    )
  })

  test('is idempotent', () => {
    const once = replaceBlock(doc, 't', 'x')
    expect(replaceBlock(once, 't', 'x')).toBe(once)
  })

  test('throws on missing, duplicated or reversed markers', () => {
    expect(() => replaceBlock('no markers', 't', 'x')).toThrow(/exactly one BEGIN/)
    expect(() => replaceBlock(`${doc}\n${doc}`, 't', 'x')).toThrow(/exactly one BEGIN/)
    const reversed = '<!-- END generated:t -->\n<!-- BEGIN generated:t -->'
    expect(() => replaceBlock(reversed, 't', 'x')).toThrow(/precedes/)
  })
})

test('firstSentence keeps the first sentence of a description', () => {
  expect(firstSentence('Exact things. More detail follows.')).toBe('Exact things.')
  expect(firstSentence('No terminal period')).toBe('No terminal period')
})

describe('workspace', () => {
  test('counts are read from package sources', async () => {
    const counts = await computeCounts(ROOT)
    const { CIPHERS } = await import('../packages/gematria/src/index.js')
    const { SEPHER_SEPHIROTH } = await import('../packages/gematria/src/lexicon.js')
    expect(counts.gematriaCiphers).toBe(CIPHERS.length)
    expect(counts.gematriaLexicon).toBe(SEPHER_SEPHIROTH.length)
    // The entropy README states its backend count and a test there checks it against the
    // code; the generator's independent count (presets excluded) must agree with it.
    const entropyReadme = readFileSync(join(ROOT, 'packages/entropy/README.md'), 'utf8')
    const stated = /entropy backends \((\d+) in `\/providers`, plus `hwRng` in `\/node`/.exec(
      entropyReadme,
    )
    expect(Number(stated?.[1])).toBe(counts.entropyProviders)
    expect(counts.entropyNode).toBe(1)
  })

  test('every workspace package appears once in the table and the graph', async () => {
    const packages = collectPackages(ROOT, await computeCounts(ROOT))
    const table = renderTable(packages)
    const graph = renderGraph(packages)
    for (const pkg of packages) {
      expect(table.split(`[\`${pkg.name}\`]`).length - 1).toBe(1)
      expect(graph.split(`["${pkg.name}"]`).length - 1).toBe(1)
    }
    expect(packages.every((p) => p.summary.length > 0)).toBe(true)
  })

  test('README.md is up to date (run `bun run readme:table`)', async () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
    expect(await generateReadme(ROOT, readme)).toBe(readme)
  })
})
