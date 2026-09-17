/**
 * Counts quoted in the generated root README summaries, computed from package sources
 * (used by `readme-table.ts`). Nothing here is typed by hand: a count that cannot be
 * derived from code does not appear in the README.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'

const PACKAGES_DIR = 'packages'

/** Counts derived from package sources (see {@link computeCounts}). */
export interface Counts {
  /** Provider factories in `@mindpeeker/entropy/providers` (presets excluded). */
  readonly entropyProviders: number
  /** Provider factories in `@mindpeeker/entropy/node`. */
  readonly entropyNode: number
  readonly gematriaCiphers: number
  readonly gematriaScripts: number
  readonly gematriaLexicon: number
  /** Directories under `packages/oracle/src/systems`. */
  readonly oracleSystems: number
  /** Root exports of `@mindpeeker/oracle` named `cast…`. */
  readonly oracleCasts: number
}

/** Resolve a relative `.js` specifier to the `.ts` file it names, if it exists. */
export function resolveLocal(fromFile: string, specifier: string): string | undefined {
  const base = resolve(dirname(fromFile), specifier)
  const candidates = [base.replace(/\.js$/, '.ts'), `${base}.ts`, join(base, 'index.ts')]
  return candidates.find((c) => existsSync(c) && statSync(c).isFile())
}

/** Exported provider factories of a barrel that are not presets of another factory. */
function providerFactories(barrel: string): number {
  const read = (file: string) =>
    ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, false)
  const exported = new Map<string, string>() // name → module file
  for (const statement of read(barrel).statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.isTypeOnly ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.exportClause ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue
    }
    const module = resolveLocal(barrel, statement.moduleSpecifier.text)
    if (!module) throw new Error(`${barrel}: cannot resolve ${statement.moduleSpecifier.text}`)
    for (const element of statement.exportClause.elements) {
      if (!element.isTypeOnly) exported.set((element.propertyName ?? element.name).text, module)
    }
  }
  const returnsProvider = new Map<string, ts.FunctionDeclaration>()
  for (const module of new Set(exported.values())) {
    for (const statement of read(module).statements) {
      const name = ts.isFunctionDeclaration(statement) ? statement.name?.text : undefined
      const type = ts.isFunctionDeclaration(statement) ? statement.type : undefined
      if (!name || exported.get(name) !== module || !type || !ts.isTypeReferenceNode(type)) continue
      const typeName = ts.isIdentifier(type.typeName) ? type.typeName.text : ''
      if (typeName === 'EntropyProvider' || typeName === 'BeaconProvider') {
        returnsProvider.set(name, statement as ts.FunctionDeclaration)
      }
    }
  }
  const isPreset = (fn: ts.FunctionDeclaration) =>
    (fn.body?.statements ?? []).some(
      (s) =>
        ts.isReturnStatement(s) &&
        s.expression !== undefined &&
        ts.isCallExpression(s.expression) &&
        ts.isIdentifier(s.expression.expression) &&
        returnsProvider.has(s.expression.expression.text),
    )
  return [...returnsProvider.values()].filter((fn) => !isPreset(fn)).length
}

async function importModule(root: string, path: string): Promise<Record<string, unknown>> {
  const file = join(root, path)
  if (!existsSync(file)) throw new Error(`count source missing: ${path}`)
  return (await import(file)) as Record<string, unknown>
}

function arrayExport(mod: Record<string, unknown>, name: string): readonly unknown[] {
  const value = mod[name]
  if (!Array.isArray(value)) throw new Error(`expected an exported array ${name}`)
  return value
}

/** Every number quoted in the generated summaries, computed from package sources. */
export async function computeCounts(root: string): Promise<Counts> {
  const entropy = join(root, PACKAGES_DIR, 'entropy', 'src')
  const gematria = await importModule(root, 'packages/gematria/src/index.ts')
  const lexicon = await importModule(root, 'packages/gematria/src/lexicon.ts')
  const oracle = await importModule(root, 'packages/oracle/src/index.ts')
  const ciphers = arrayExport(gematria, 'CIPHERS')
  const scripts = new Set(ciphers.map((c) => (c as { script?: unknown }).script))
  const systemsDir = join(root, PACKAGES_DIR, 'oracle', 'src', 'systems')
  return {
    entropyProviders: providerFactories(join(entropy, 'providers', 'index.ts')),
    entropyNode: providerFactories(join(entropy, 'node', 'index.ts')),
    gematriaCiphers: ciphers.length,
    gematriaScripts: scripts.size,
    gematriaLexicon: arrayExport(lexicon, 'SEPHER_SEPHIROTH').length,
    oracleSystems: readdirSync(systemsDir).filter((d) =>
      statSync(join(systemsDir, d)).isDirectory(),
    ).length,
    oracleCasts: Object.keys(oracle).filter(
      (k) => /^cast[A-Z]/.test(k) && typeof oracle[k] === 'function',
    ).length,
  }
}
