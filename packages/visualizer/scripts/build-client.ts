/**
 * Bundle the WebGL2 client with `Bun.build` (built into bun — zero npm build
 * dependencies) and copy `client/index.html` next to it. Output:
 * `dist/client/app.js` + `dist/client/index.html`, which the dashboard
 * server resolves relative to its own compiled location.
 */
import { fileURLToPath } from 'node:url'

const packageRoot = new URL('..', import.meta.url)
const entry = fileURLToPath(new URL('client/app.ts', packageRoot))
const outdir = fileURLToPath(new URL('dist/client', packageRoot))

const result = await Bun.build({
  entrypoints: [entry],
  outdir,
  target: 'browser',
  format: 'esm',
  minify: true,
  sourcemap: 'linked',
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

await Bun.write(
  new URL('dist/client/index.html', packageRoot),
  Bun.file(new URL('client/index.html', packageRoot)),
)

for (const artifact of result.outputs) {
  console.log(`built ${artifact.path} (${artifact.size} bytes)`)
}
console.log('copied client/index.html → dist/client/index.html')
