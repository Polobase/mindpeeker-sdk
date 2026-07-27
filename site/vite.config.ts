import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const repo = resolve(root, '..')

// The workspace packages (and the reused visualizer client) are TypeScript with
// NodeNext-style `.js` import specifiers. Vite bundles their source directly, so
// rewrite a relative `./x.js` import to `./x.ts` whenever only the `.ts` exists.
function jsToTs(): Plugin {
  return {
    name: 'js-to-ts',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null
      const ts = `${resolve(dirname(importer), source).slice(0, -3)}.ts`
      return existsSync(ts) ? ts : null
    },
  }
}

// One HTML entry per package page, plus the landing index. Nested dirs give
// pretty URLs (…/gematria/). Keep in sync with src/shared/manifest.ts.
const PAGES = [
  'gematria',
  'visualizer',
  'oracle',
  'rate',
  'field',
  'negentropy',
  'entropy',
  'flow',
  'psi',
  'scan',
  'vdf',
] as const

const input: Record<string, string> = { main: resolve(root, 'index.html') }
for (const page of PAGES) {
  const html = resolve(root, page, 'index.html')
  if (existsSync(html)) input[page] = html
}

// Resolve every @mindpeeker/* import to the package SOURCE, so the site builds
// straight from TypeScript and needs no package `dist` (and no workspace build
// order) — critical for a clean CI checkout. The `jsToTs` plugin then handles
// each package's internal NodeNext `.js` specifiers.
const pkg = (p: string) => resolve(repo, 'packages', p)
const BARE = [
  'entropy',
  'negentropy',
  'flow',
  'psi',
  'rate',
  'oracle',
  'vdf',
  'scan',
  'field',
  'gematria',
]
const alias = [
  // Exact subpaths first, so the bare-root regexes below never swallow them.
  { find: '@mindpeeker/entropy/providers', replacement: pkg('entropy/src/providers/index.ts') },
  { find: '@mindpeeker/negentropy/numerics', replacement: pkg('negentropy/src/numerics.ts') },
  { find: '@mindpeeker/gematria/oracle', replacement: pkg('gematria/src/oracle.ts') },
  { find: '@mindpeeker/gematria/lexicon', replacement: pkg('gematria/src/lexicon.ts') },
  { find: '@mindpeeker/field/geo', replacement: pkg('field/src/geo.ts') },
  // Bare package roots, anchored so they match only the exact specifier.
  ...BARE.map((p) => ({
    find: new RegExp(`^@mindpeeker/${p}$`),
    replacement: pkg(`${p}/src/index.ts`),
  })),
  // The visualizer package does not export its browser client; reach it by path.
  { find: '@viz', replacement: pkg('visualizer') },
]

export default defineConfig({
  // Project page served under https://polobase.github.io/mindpeeker-sdk/
  base: '/mindpeeker-sdk/',
  plugins: [jsToTs()],
  resolve: { alias },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input },
  },
})
