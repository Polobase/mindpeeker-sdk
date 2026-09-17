/**
 * Static client assets for the dashboard server. BUN-ONLY (`Bun.file`).
 * Every asset is served with `Cache-Control: no-cache`, so a rebuilt bundle is
 * revalidated instead of being served stale from the browser cache.
 */

/** URL path → file name and media type of every servable client asset. */
const CLIENT_ASSETS: Readonly<Record<string, { readonly file: string; readonly type: string }>> =
  Object.freeze({
    '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
    '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
    '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
    '/app.js.map': { file: 'app.js.map', type: 'application/json; charset=utf-8' },
  })

const NO_CACHE = 'no-cache'

const STUB_PAGE =
  '<!doctype html><meta charset="utf-8"><title>mindpeeker visualizer</title>' +
  '<body style="font: 14px monospace; background: #0d1117; color: #c9d1d9; padding: 2rem">' +
  '<p>Client bundle not found — run <code>bun run build</code> in packages/visualizer.</p>'

/**
 * Serve the bundled client asset for `pathname`, or `undefined` when the path
 * is not a client asset. Before `bun run build` the index falls back to a stub
 * page and the other assets 404.
 */
export async function clientAssetResponse(pathname: string): Promise<Response | undefined> {
  const asset = CLIENT_ASSETS[pathname]
  if (!asset) return undefined
  const headers = { 'content-type': asset.type, 'cache-control': NO_CACHE }
  // Compiled layout: dist/server/assets.js → dist/client/*.
  // Source layout (tests, `bun src/cli.ts`): src/server/assets.ts → dist/client/*.
  for (const rel of [`../client/${asset.file}`, `../../dist/client/${asset.file}`]) {
    const file = Bun.file(new URL(rel, import.meta.url))
    if (await file.exists()) return new Response(file, { headers })
  }
  if (asset.file === 'index.html') return new Response(STUB_PAGE, { headers })
  return new Response('not built', { status: 404, headers: { 'cache-control': NO_CACHE } })
}
