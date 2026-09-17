/**
 * Root README generator. Writes two generated blocks into README.md:
 *
 * - `package-table`: one row per `packages/*` workspace — layer, name linked to the
 *   package directory, a one-sentence summary, and its workspace dependencies. The
 *   dependency column is derived from code: the declared `dependencies` of each
 *   package.json, the subpaths (`./numerics`, …) its `src` actually imports, and which
 *   of its own entry points (exports keys, `bin` commands) reach those imports.
 * - `dependency-graph`: the same edges as a mermaid graph.
 *
 * The counts inside the summaries are computed from source, never typed by hand:
 * entropy backends (exported provider factories that are not presets of another
 * factory), gematria ciphers, scripts and lexicon entries, oracle systems and casts.
 *
 * Usage: bun scripts/readme-table.ts [--check]
 *   (no flag) rewrite the blocks in README.md when they changed
 *   --check   exit 1 when README.md is stale (run in `bun run check`)
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { type Counts, computeCounts, resolveLocal } from './readme-counts.js'

export { type Counts, computeCounts } from './readme-counts.js'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SCOPE = '@mindpeeker/'
const PACKAGES_DIR = 'packages'

/** Layers in table order; packages without a curated entry go last, alphabetically. */
const LAYERS = [
  'Randomness sources',
  'Statistics',
  'Experiment protocols',
  'Symbolic encodings',
  'Integrity and time',
  'Display',
] as const
type Layer = (typeof LAYERS)[number]

interface Curated {
  readonly layer: Layer
  readonly summary: (c: Counts) => string
}

/** One sentence per package. Keep numbers out of these strings unless they come from `c`. */
const CURATED: Readonly<Record<string, Curated>> = {
  entropy: {
    layer: 'Randomness sources',
    summary: (c) =>
      `Randomness from ${c.entropyProviders + c.entropyNode} backends (cloud QRNGs, public beacons, local hardware and a seeded HMAC_DRBG control) behind one interface, with SP 800-90B health tests, conditioning, beacon round metadata and fallback/xorMix/race strategies.`,
  },
  negentropy: {
    layer: 'Statistics',
    summary: () =>
      'GCP-style network statistics, anytime-valid test martingales, pre-registered experiment sessions with versioned registration digests, and randomness extraction; exact shared numerics in `./numerics`.',
  },
  flow: {
    layer: 'Statistics',
    summary: () =>
      'Transfer entropy and information dynamics for discrete symbol streams: conditional and collective TE, active information storage, a χ² test with an adequacy guard, surrogate families and streaming windows.',
  },
  coincidence: {
    layer: 'Statistics',
    summary: () =>
      "Exact coincidence probabilities: birthday-problem generalisations (non-uniform, k-fold, near and multi-attribute matches), Fisher's 1924 match scores and an exact clustering test for event series.",
  },
  judging: {
    layer: 'Statistics',
    summary: () =>
      'Exact scoring and null distributions for forced-choice and free-response designs: binomial and Bayes-factor scoring, closed-deck and feedback baselines, rank statistics, displacement variance and optional-stopping risk.',
  },
  psi: {
    layer: 'Experiment protocols',
    summary: () =>
      'Mind–matter-interaction protocols with valid nulls: tripolar runs with committed schedules and a control arm, GCP event analysis and a basket-file reader, seeded permutation surrogates, Bayes factors and e-processes, and hash-chained JSONL recording.',
  },
  field: {
    layer: 'Experiment protocols',
    summary: () =>
      "Point fields drawn from an entropy stream and tested against complete spatial randomness: calibrated attractor/void p-values, edge-corrected Ripley's K with global envelopes, quadrat, KDE and scan statistics, plus `./geo` samplers and geohash.",
  },
  scan: {
    layer: 'Experiment protocols',
    summary: () =>
      'Radionic scanning and broadcasting rebuilt on the other packages: AetherOne-parity race and General Vitality with exact null tails, a per-item binomial deviation null with multiplicity control, and pre-registered tripolar scans.',
  },
  oracle: {
    layer: 'Symbolic encodings',
    summary: (c) =>
      `Bias-free casts for ${c.oracleSystems} divination systems (${c.oracleCasts} cast functions: I Ching, Tarot, runes, geomancy, Ifá and others) with exact rational probabilities, rejection sampling and entropy accounting.`,
  },
  gematria: {
    layer: 'Symbolic encodings',
    summary: (c) =>
      `${c.gematriaCiphers} exact-integer ciphers across ${c.gematriaScripts} scripts, temurah and Aiq Beker tools, collision statistics for equal-value matches, a ${c.gematriaLexicon}-entry public-domain lexicon (\`./lexicon\`) and an entropy-to-word bridge (\`./oracle\`).`,
  },
  rate: {
    layer: 'Symbolic encodings',
    summary: () =>
      "Malcolm Rae's base-44 radionic rates as exact geometry: parsing, digit-to-angle maps, directional statistics, card SVG and deterministic, reversible stream modulation.",
  },
  vdf: {
    layer: 'Integrity and time',
    summary: () =>
      'Verifiable delay functions in the signed quadratic residues of an RSA group: sequential squaring with Pietrzak and Wesolowski proofs, modulus sanity checks and versioned beacon seals.',
  },
  ledger: {
    layer: 'Integrity and time',
    summary: () =>
      'Tamper-evident records with WebCrypto only: RFC 8785 canonical JSON, hash-chained JSONL, RFC 6962 Merkle proofs, signed-note checkpoints, commit–reveal, registration records and beacon/VDF time brackets.',
  },
  ephemeris: {
    layer: 'Integrity and time',
    summary: () =>
      "Exact time and sky coordinates for testing time-of-day, sidereal and lunar hypotheses: Julian day, ΔT, sidereal time, Meeus Sun and Moon, moon phases and Spottiswoode's LST window scan with a seeded permutation null.",
  },
  visualizer: {
    layer: 'Display',
    summary: () =>
      'Bun WebSocket server and zero-dependency WebGL2 dashboard for live byte streams, statistic series with pointwise and anytime-valid bands, matrices and rate cards, with hash-chained record and replay.',
  },
}

interface Manifest {
  readonly name?: string
  readonly description?: string
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly exports?: Readonly<Record<string, string | Readonly<Record<string, string>>>>
  readonly bin?: string | Readonly<Record<string, string>>
}

/** A workspace dependency as it is used in code. */
export interface Dependency {
  /** Directory name of the dependency, e.g. `negentropy`. */
  readonly dir: string
  /** Imported subpaths: `.` for the root, `./numerics`, … (sorted). */
  readonly subpaths: readonly string[]
  /**
   * Entry points of the importing package that reach the import (`.`, `./oracle`,
   * `bin:mindpeeker-viz`), or `null` when every entry point does.
   */
  readonly onlyFrom: readonly string[] | null
}

export interface PackageInfo {
  readonly dir: string
  readonly name: string
  readonly layer: Layer | null
  readonly summary: string
  readonly deps: readonly Dependency[]
}

function readManifest(path: string): Manifest {
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest
}

/** Module specifiers of one source file: imports, re-exports, dynamic and type imports. */
export function moduleSpecifiers(code: string, fileName = 'file.ts'): string[] {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, false)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push(node.arguments[0].text)
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      found.push(node.argument.literal.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .map((f) => join(dir, f))
    .sort()
}

/** `./dist/foo.js` → `<pkg>/src/foo.ts`. */
function srcOf(pkgDir: string, distPath: string): string | undefined {
  const match = /^\.\/dist\/(.+)\.js$/.exec(distPath)
  const file = match ? join(pkgDir, 'src', `${match[1]}.ts`) : undefined
  return file && existsSync(file) ? file : undefined
}

/** Entry labels (`.`, `./sub`, `bin:name`) mapped to their src files. */
function entryPoints(pkgDir: string, manifest: Manifest): Map<string, string> {
  const entries = new Map<string, string>()
  for (const [key, target] of Object.entries(manifest.exports ?? {})) {
    const js = typeof target === 'string' ? target : (target.default ?? target.import)
    const file = js ? srcOf(pkgDir, js) : undefined
    if (file) entries.set(key, file)
  }
  const bins =
    typeof manifest.bin === 'string' ? { [manifest.name ?? 'bin']: manifest.bin } : manifest.bin
  for (const [name, path] of Object.entries(bins ?? {})) {
    const file = srcOf(pkgDir, path)
    if (file) entries.set(`bin:${name}`, file)
  }
  return entries
}

/** Collect every `packages/*` workspace with its dependency usage and summary. */
export function collectPackages(root: string, counts: Counts): PackageInfo[] {
  const base = join(root, PACKAGES_DIR)
  const dirs = readdirSync(base).filter((d) => existsSync(join(base, d, 'package.json')))
  const names = new Map<string, string>()
  const manifests = new Map<string, Manifest>()
  for (const dir of dirs) {
    const manifest = readManifest(join(base, dir, 'package.json'))
    if (!manifest.name?.startsWith(SCOPE)) continue
    names.set(manifest.name, dir)
    manifests.set(dir, manifest)
  }

  const packages: PackageInfo[] = []
  for (const [dir, manifest] of manifests) {
    const pkgDir = join(base, dir)
    const files = sourceFiles(join(pkgDir, 'src'))
    const graph = new Map<string, string[]>()
    const uses = new Map<string, Map<string, Set<string>>>() // dep → subpath → files
    for (const file of files) {
      const local: string[] = []
      for (const spec of moduleSpecifiers(readFileSync(file, 'utf8'), file)) {
        if (spec.startsWith('.')) {
          const target = resolveLocal(file, spec)
          if (target) local.push(target)
        } else if (spec.startsWith(SCOPE)) {
          const [, pkg = '', ...rest] = spec.split('/')
          const depName = `${SCOPE}${pkg}`
          if (depName === manifest.name) continue
          const subpath = rest.length === 0 ? '.' : `./${rest.join('/')}`
          const bySub = uses.get(depName) ?? new Map<string, Set<string>>()
          bySub.set(subpath, (bySub.get(subpath) ?? new Set()).add(file))
          uses.set(depName, bySub)
        }
      }
      graph.set(file, local)
    }

    const declared = Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })
      .filter((d) => d.startsWith(SCOPE))
      .sort()
    for (const used of uses.keys()) {
      if (!declared.includes(used)) {
        throw new Error(`${manifest.name} imports ${used} in src but does not declare it`)
      }
    }

    const entries = entryPoints(pkgDir, manifest)
    const reach = new Map<string, Set<string>>()
    for (const [label, file] of entries) {
      const seen = new Set<string>()
      const stack = [file]
      while (stack.length > 0) {
        const next = stack.pop() as string
        if (seen.has(next)) continue
        seen.add(next)
        stack.push(...(graph.get(next) ?? []))
      }
      reach.set(label, seen)
    }

    const deps = declared.map((depName): Dependency => {
      const depDir = names.get(depName)
      if (!depDir) throw new Error(`${manifest.name} depends on unknown workspace ${depName}`)
      const bySub = uses.get(depName) ?? new Map<string, Set<string>>()
      const importing = new Set([...bySub.values()].flatMap((s) => [...s]))
      const from = [...reach].filter(([, seen]) => [...importing].some((f) => seen.has(f)))
      const onlyFrom = from.length === entries.size ? null : from.map(([label]) => label).sort()
      return { dir: depDir, subpaths: [...bySub.keys()].sort(), onlyFrom }
    })

    const curated = CURATED[dir]
    packages.push({
      dir,
      name: manifest.name as string,
      layer: curated?.layer ?? null,
      summary: curated ? curated.summary(counts) : firstSentence(manifest.description ?? ''),
      deps,
    })
  }

  const rank = (p: PackageInfo) => (p.layer ? LAYERS.indexOf(p.layer) : LAYERS.length)
  const curatedOrder = Object.keys(CURATED)
  return packages.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      curatedOrder.indexOf(a.dir) - curatedOrder.indexOf(b.dir) ||
      a.dir.localeCompare(b.dir),
  )
}

/** The first sentence of a package.json description (fallback summary). */
export function firstSentence(text: string): string {
  const trimmed = text.trim()
  const match = /^(.+?[.!?])(\s|$)/.exec(trimmed)
  return match?.[1] ?? trimmed
}

/** `(root, ./numerics; only from ./oracle)` notes for one dependency, or `[]`. */
export function dependencyNotes(dep: Dependency, code: (s: string) => string): string[] {
  const notes: string[] = []
  if (!(dep.subpaths.length === 1 && dep.subpaths[0] === '.')) {
    notes.push(
      dep.subpaths.length === 0
        ? 'declared, not imported'
        : dep.subpaths.map((s) => (s === '.' ? 'root' : code(s))).join(', '),
    )
  }
  if (dep.onlyFrom) {
    const where = dep.onlyFrom.map((label) =>
      label.startsWith('bin:')
        ? `the ${code(label.slice(4))} CLI`
        : label === '.'
          ? 'the root entry'
          : code(label),
    )
    notes.push(where.length === 0 ? 'no entry point' : `only from ${where.join(', ')}`)
  }
  return notes
}

export function renderTable(packages: readonly PackageInfo[]): string {
  const tick = (s: string) => `\`${s}\``
  const rows = ['| Layer | Package | What it does | Workspace dependencies |', '|---|---|---|---|']
  let layer: Layer | null | undefined
  for (const pkg of packages) {
    const layerCell = pkg.layer === layer ? '' : (pkg.layer ?? 'Other')
    layer = pkg.layer
    const deps =
      pkg.deps.length === 0
        ? '—'
        : pkg.deps
            .map((d) => {
              const notes = dependencyNotes(d, tick)
              return notes.length === 0 ? tick(d.dir) : `${tick(d.dir)} (${notes.join('; ')})`
            })
            .join('<br>')
    const summary = pkg.summary.replace(/\|/g, '\\|')
    rows.push(
      `| ${layerCell} | [\`${pkg.name}\`](${PACKAGES_DIR}/${pkg.dir}) | ${summary} | ${deps} |`,
    )
  }
  return rows.join('\n')
}

export function renderGraph(packages: readonly PackageInfo[]): string {
  const lines = ['```mermaid', 'graph TD']
  for (const pkg of packages) lines.push(`  ${nodeId(pkg.dir)}["${pkg.name}"]`)
  for (const pkg of packages) {
    for (const dep of pkg.deps) {
      // Mermaid treats `;` as a statement separator, so graph labels join notes with ` · `.
      const notes = dependencyNotes(dep, (s) => s)
      const edge = notes.length === 0 ? '-->' : `-- "${notes.join(' · ')}" -->`
      lines.push(`  ${nodeId(pkg.dir)} ${edge} ${nodeId(dep.dir)}`)
    }
  }
  lines.push('```')
  return lines.join('\n')
}

/** Mermaid node ids: prefixed so words like `end` or a leading `o`/`x` never parse as syntax. */
function nodeId(dir: string): string {
  return `pkg_${dir.replace(/[^A-Za-z0-9_]/g, '_')}`
}

/**
 * Replace the lines between `<!-- BEGIN generated:<block> … -->` and
 * `<!-- END generated:<block> -->`. Each marker must occur exactly once.
 */
export function replaceBlock(markdown: string, block: string, content: string): string {
  const begin = new RegExp(`^<!-- BEGIN generated:${block}\\b.*-->$`, 'gm')
  const end = new RegExp(`^<!-- END generated:${block} -->$`, 'gm')
  const begins = [...markdown.matchAll(begin)]
  const ends = [...markdown.matchAll(end)]
  if (begins.length !== 1 || ends.length !== 1) {
    throw new Error(
      `README needs exactly one BEGIN and one END marker for generated:${block} (found ${begins.length} and ${ends.length})`,
    )
  }
  const open = begins[0] as RegExpMatchArray
  const close = ends[0] as RegExpMatchArray
  const from = (open.index ?? 0) + open[0].length
  const to = close.index ?? 0
  if (to < from) throw new Error(`END marker of generated:${block} precedes its BEGIN marker`)
  return `${markdown.slice(0, from)}\n${content}\n${markdown.slice(to)}`
}

/** README.md with both generated blocks brought up to date. */
export async function generateReadme(root: string, readme: string): Promise<string> {
  const packages = collectPackages(root, await computeCounts(root))
  const withTable = replaceBlock(readme, 'package-table', renderTable(packages))
  return replaceBlock(withTable, 'dependency-graph', renderGraph(packages))
}

async function main(argv: readonly string[]): Promise<number> {
  const unknown = argv.filter((a) => a !== '--check')
  if (unknown.length > 0) {
    console.error(
      `unknown argument(s): ${unknown.join(' ')}\nusage: bun scripts/readme-table.ts [--check]`,
    )
    return 2
  }
  const path = join(ROOT, 'README.md')
  const current = readFileSync(path, 'utf8')
  const next = await generateReadme(ROOT, current)
  if (argv.includes('--check')) {
    if (next === current) {
      console.log('README package table and dependency graph are up to date')
      return 0
    }
    console.error('README.md is stale: run `bun run readme:table` and commit the result')
    return 1
  }
  if (next !== current) writeFileSync(path, next)
  console.log(next === current ? 'README.md already up to date' : 'README.md updated')
  return 0
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
