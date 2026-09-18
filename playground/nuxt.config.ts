import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve @mindpeeker/* to package SOURCE (like the Vite site) so the app needs
// no package dist and no workspace build order. jsToTs rewrites the packages'
// NodeNext `.js` specifiers to `.ts`.
//
// IMPORTANT: these aliases exist for the CLIENT bundle only. Nitro (prerender /
// server) does not see them, so every import of `@mindpeeker/*` must live in a
// `*.client.vue` component, a module only such a component imports (app/lib/*),
// or a Web Worker under app/workers/.
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
  // Exact subpaths first, so the bare-root regexes below never swallow them.
  { find: '@mindpeeker/entropy/providers', replacement: pkg('entropy/src/providers/index.ts') },
  { find: '@mindpeeker/negentropy/numerics', replacement: pkg('negentropy/src/numerics.ts') },
  { find: '@mindpeeker/gematria/oracle', replacement: pkg('gematria/src/oracle.ts') },
  { find: '@mindpeeker/gematria/lexicon', replacement: pkg('gematria/src/lexicon.ts') },
  { find: '@mindpeeker/field/geo', replacement: pkg('field/src/geo.ts') },
  // Bare package roots, anchored so they match only the exact specifier.
  ...[
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
    'ledger',
    'coincidence',
    'ephemeris',
    'judging',
  ].map((p) => ({ find: new RegExp(`^@mindpeeker/${p}$`), replacement: pkg(`${p}/src/index.ts`) })),
  // The visualizer package doesn't export its browser client; reach it by path.
  { find: '@viz', replacement: pkg('visualizer') },
]

// Isolated build/output directories, so several agents can build the same app
// at once without clobbering the shared `.nuxt` / `.output`. Unset → defaults.
const buildDir = process.env.PLAYGROUND_BUILD_DIR
const outputDir = process.env.PLAYGROUND_OUTPUT_DIR
const baseURL = process.env.NUXT_APP_BASE_URL || '/mindpeeker-sdk/'

export default defineNuxtConfig({
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  ...(buildDir ? { buildDir } : {}),
  // Bundle icons from the installed @iconify-json/lucide collection so the
  // static build renders them offline: `clientBundle.scan` collects every
  // `i-lucide-*` / `lucide:*` literal in app/**, Nuxt UI adds its own icons
  // through the `icon:clientBundleIcons` hook, and `provider: 'none'` stops the
  // runtime from ever calling the (nonexistent) /api/_nuxt_icon endpoint or the
  // Iconify API. Write icon names as complete literals — a name built at
  // runtime cannot be scanned and will not render.
  icon: {
    provider: 'none',
    fallbackToApi: false,
    serverBundle: 'local',
    clientBundle: {
      scan: { globInclude: ['app/**/*.{vue,ts}'] },
      sizeLimitKb: 512,
    },
  },
  compatibilityDate: '2025-07-01',
  ssr: true,
  // Project page: https://polobase.github.io/mindpeeker-sdk/ (override via NUXT_APP_BASE_URL).
  app: {
    baseURL,
    head: {
      htmlAttrs: { lang: 'en' },
      // The title itself comes from app.vue's titleTemplate + each page's title.
      // Explicit favicon: without it the browser asks the server for
      // /favicon.ico on every page load and gets a 404.
      link: [{ rel: 'icon', type: 'image/svg+xml', href: `${baseURL}favicon.svg` }],
    },
  },
  nitro: {
    prerender: { crawlLinks: true, routes: ['/'], failOnError: false },
    ...(outputDir ? { output: { dir: outputDir } } : {}),
  },
  vite: {
    resolve: { alias },
    plugins: [jsToTs()],
    // Web Workers get the same treatment as the app: ES output (so a worker can
    // `import` the SDK source) and the `.js` → `.ts` specifier rewrite. The
    // aliases above are shared with the worker build by Vite.
    worker: { format: 'es', plugins: () => [jsToTs()] },
  },
})
