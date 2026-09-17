/**
 * Smoke test for the cookbook recipes: every script runs offline with --smoke, exits 0
 * within a timeout, prints the same report twice (offline runs are deterministic), and
 * appears verbatim in docs/cookbook.md.
 */
import { expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const EXAMPLES = join(import.meta.dir, '..')
const SRC = join(EXAMPLES, 'src')
const COOKBOOK = join(EXAMPLES, '..', 'docs', 'cookbook.md')
const RECIPES = readdirSync(SRC)
  .filter((file) => /^\d\d-[a-z0-9-]+\.ts$/.test(file))
  .sort()
const LIBS = readdirSync(join(SRC, 'lib'))
  .filter((file) => file.endsWith('.ts'))
  .sort()
  .map((file) => `lib/${file}`)
const TIMEOUT_MS = 60_000
const PARALLEL = 4

interface Run {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

async function run(file: string): Promise<Run> {
  const proc = Bun.spawn([process.execPath, join(SRC, file), '--smoke'], {
    cwd: EXAMPLES,
    stdout: 'pipe',
    stderr: 'pipe',
    // An unreachable proxy: an offline recipe that touches the network fails loudly.
    env: { ...process.env, HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9' },
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, TIMEOUT_MS)
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  clearTimeout(timer)
  return { code, stdout, stderr, timedOut }
}

let pending: Promise<Map<string, Run[]>> | undefined

/** Run every recipe twice, a few at a time; started by the first test that needs it. */
function runAll(): Promise<Map<string, Run[]>> {
  pending ??= (async () => {
    const results = new Map<string, Run[]>()
    const queue = RECIPES.flatMap((file) => [file, file])
    await Promise.all(
      Array.from({ length: PARALLEL }, async () => {
        for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
          const done = await run(file)
          results.set(file, [...(results.get(file) ?? []), done])
        }
      }),
    )
    return results
  })()
  return pending
}

test('the cookbook has twelve recipes', () => {
  expect(RECIPES).toHaveLength(12)
})

for (const file of RECIPES) {
  test(
    `${file} runs offline, exits 0 and is deterministic`,
    async () => {
      const [first, second] = (await runAll()).get(file) ?? []
      for (const r of [first, second]) {
        expect(r).toBeDefined()
        expect(r?.timedOut).toBe(false)
        if (r?.code !== 0) console.error(`${file} stderr:\n${r?.stderr}`)
        expect(r?.code).toBe(0)
        expect(r?.stdout.trim().length).toBeGreaterThan(0)
      }
      expect(second?.stdout).toBe(first?.stdout as string)
    },
    4 * TIMEOUT_MS,
  )
}

test('docs/cookbook.md shows every script verbatim', () => {
  const fences = [...readFileSync(COOKBOOK, 'utf8').matchAll(/^```ts\n([\s\S]*?)^```$/gm)].map(
    (m) => m[1] as string,
  )
  for (const file of [...LIBS, ...RECIPES]) {
    expect(fences).toContain(readFileSync(join(SRC, file), 'utf8'))
  }
})
