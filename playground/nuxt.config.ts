import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve @mindpeeker/* to package SOURCE (like the Vite site) so the app needs
// no package dist and no workspace build order. jsToTs rewrites the packages'
// NodeNext `.js` specifiers to `.ts`.
const root = fileURLToPath(new URL('.', import.meta.url))
const repo = resolve(root, '..')
const pkg = (p: string) => resolve(repo, 'packages', p)

function jsToTs() {
  return {
    name: 'js-to-ts',
    enforce: 'pre' as const,
    resolveId(source: string, importer?: string) {
      if (!importer || !source.startsWith('.') || !source.endsWith('.js')) return null
      const ts = `${resolve(dirname(importer), source).slice(0, -3)}.ts`
      return existsSync(ts) ? ts : null
    },
  }
}

const alias = [
  { find: '@mindpeeker/entropy/providers', replacement: pkg('entropy/src/providers/index.ts') },
  { find: '@mindpeeker/negentropy/numerics', replacement: pkg('negentropy/src/numerics.ts') },
  { find: '@mindpeeker/gematria/oracle', replacement: pkg('gematria/src/oracle.ts') },
  { find: '@mindpeeker/gematria/lexicon', replacement: pkg('gematria/src/lexicon.ts') },
  { find: '@mindpeeker/field/geo', replacement: pkg('field/src/geo.ts') },
  ...['entropy', 'negentropy', 'flow', 'psi', 'rate', 'oracle', 'vdf', 'scan', 'field', 'gematria'].map(
    (p) => ({ find: new RegExp(`^@mindpeeker/${p}$`), replacement: pkg(`${p}/src/index.ts`) }),
  ),
  // The visualizer package doesn't export its browser client; reach it by path.
  { find: '@viz', replacement: pkg('visualizer') },
]

export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  // Bundle icons from the installed @iconify-json/lucide collection so a static,
  // offline build renders them without hitting the Iconify API.
  icon: { serverBundle: 'local' },
  compatibilityDate: '2025-07-01',
  ssr: true,
  // Project page: https://polobase.github.io/mindpeeker-sdk/ (override via NUXT_APP_BASE_URL).
  app: {
    baseURL: process.env.NUXT_APP_BASE_URL || '/mindpeeker-sdk/',
    head: {
      htmlAttrs: { lang: 'en' },
      title: 'mindpeeker-sdk',
    },
  },
  nitro: { prerender: { crawlLinks: true, routes: ['/'], failOnError: false } },
  vite: {
    resolve: { alias },
    plugins: [jsToTs()],
  },
})
