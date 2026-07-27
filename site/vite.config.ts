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

export default defineConfig({
  // Project page served under https://polobase.github.io/mindpeeker-sdk/
  base: '/mindpeeker-sdk/',
  plugins: [jsToTs()],
  // The visualizer package does not export its browser client, so the
  // visualizer page reaches it by source path through this alias.
  resolve: { alias: { '@viz': resolve(repo, 'packages/visualizer') } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input },
  },
})
