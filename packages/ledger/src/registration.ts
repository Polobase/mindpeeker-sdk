import { canonicalize } from './canonical.js'
import { LedgerError } from './errors.js'
import { isHashHex, sha256Hex } from './hash.js'
import type {
  DataSource,
  Hypothesis,
  MultiplicityCorrection,
  Registration,
  SamplePlan,
} from './types.js'

/** Schema tag of the hashed registration envelope `{ schema, registration }`. */
export const REGISTRATION_SCHEMA = 'mindpeeker-ledger/registration/1'

type Obj = Record<string, unknown>

function fail(path: string, message: string): never {
  throw new LedgerError('invalid_registration', `${path} ${message}`)
}

function object(value: unknown, path: string, allowed: readonly string[]): Obj {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'must be an object')
  }
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, 'is not a registration field')
  }
  return value as Obj
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(path, 'must be a non-empty string')
  return value
}

function optionalText(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : text(value, path)
}

function oneOf<T extends string>(value: unknown, path: string, options: readonly T[]): T {
  if (typeof value !== 'string' || !options.includes(value as T)) {
    fail(path, `must be one of ${options.join(' | ')}`)
  }
  return value as T
}

function count(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    fail(path, 'must be a safe integer ≥ 1')
  }
  return value
}

function hash(value: unknown, path: string): string {
  if (!isHashHex(value)) fail(path, 'must be a lower-case hex SHA-256 (64 digits)')
  return value
}

function list(value: unknown, path: string, min: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length < min) {
    fail(path, min > 0 ? `must be an array with at least ${min} item(s)` : 'must be an array')
  }
  return value
}

/** Drop undefined members so the result is canonical JSON. */
function compact<T extends object>(value: T): T {
  return Object.freeze(
    Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)),
  ) as T
}

const DIRECTIONS = ['two-sided', 'greater', 'less'] as const
const CORRECTIONS: readonly MultiplicityCorrection[] = [
  'none',
  'bonferroni',
  'holm',
  'benjamini-hochberg',
]

function hypothesis(value: unknown, path: string): Hypothesis {
  const h = object(value, path, ['id', 'statement', 'kind', 'statistic', 'null', 'direction'])
  const kind = oneOf(h.kind, `${path}.kind`, ['confirmatory', 'exploratory'] as const)
  const confirmatory = kind === 'confirmatory'
  const need = (key: string) =>
    confirmatory || h[key] !== undefined ? text(h[key], `${path}.${key}`) : undefined
  return compact({
    id: text(h.id, `${path}.id`),
    statement: text(h.statement, `${path}.statement`),
    kind,
    statistic: need('statistic'),
    null: need('null'),
    direction:
      confirmatory || h.direction !== undefined
        ? oneOf(h.direction, `${path}.direction`, DIRECTIONS)
        : undefined,
  })
}

function sample(value: unknown, path: string): SamplePlan {
  const kind = oneOf((value as Obj | null)?.kind, `${path}.kind`, ['fixed', 'sequential'] as const)
  if (kind === 'fixed') {
    const s = object(value, path, ['kind', 'size', 'unit'])
    return compact({
      kind,
      size: count(s.size, `${path}.size`),
      unit: text(s.unit, `${path}.unit`),
    })
  }
  const s = object(value, path, ['kind', 'rule', 'minSize', 'maxSize', 'unit', 'planHash'])
  const maxSize = count(s.maxSize, `${path}.maxSize`)
  const minSize = s.minSize === undefined ? undefined : count(s.minSize, `${path}.minSize`)
  if (minSize !== undefined && minSize > maxSize) fail(`${path}.minSize`, 'exceeds maxSize')
  return compact({
    kind,
    rule: text(s.rule, `${path}.rule`),
    minSize,
    maxSize,
    unit: text(s.unit, `${path}.unit`),
    planHash: s.planHash === undefined ? undefined : hash(s.planHash, `${path}.planHash`),
  })
}

function dataSource(value: unknown, path: string): DataSource {
  const d = object(value, path, ['name', 'description', 'role'])
  return compact({
    name: text(d.name, `${path}.name`),
    description: optionalText(d.description, `${path}.description`),
    role:
      d.role === undefined
        ? undefined
        : oneOf(d.role, `${path}.role`, ['experimental', 'control'] as const),
  })
}

function unique(values: readonly string[], path: string, what: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) fail(path, `has a duplicate ${what} ${JSON.stringify(value)}`)
    seen.add(value)
  }
}

/**
 * Validate a registration against the schema and return a normalized,
 * deeply frozen copy (optional members that are `undefined` are dropped).
 * Unknown fields are rejected — a misspelled field would otherwise vanish
 * from the hashed record unnoticed.
 *
 * Rules: non-empty `title`; at least one hypothesis, ids unique, at least one
 * confirmatory, and every confirmatory hypothesis names its `statistic`,
 * `null` and `direction`; `primary` is the id of a confirmatory hypothesis;
 * `0 < alpha < 1`; `correction` is required when more than one hypothesis is
 * confirmatory; `sample` is `{ kind: 'fixed', size, unit }` or
 * `{ kind: 'sequential', rule, maxSize, minSize?, unit, planHash? }`;
 * `analysisPlanHash` (and `supersedes`, `planHash`) are lower-case hex
 * SHA-256; `exclusions` is an array of non-empty strings (empty = none);
 * at least one data source, names unique.
 *
 * Validation checks structure, not scientific adequacy: a registration that
 * passes can still be underpowered or test the wrong thing.
 *
 * @throws {LedgerError} `invalid_registration` naming the offending path.
 */
export function validateRegistration(value: unknown): Registration {
  const r = object(value, '$', [
    'title',
    'authors',
    'hypotheses',
    'primary',
    'alpha',
    'correction',
    'sample',
    'analysisPlanHash',
    'exclusions',
    'dataSources',
    'blinding',
    'supersedes',
    'notes',
  ])
  const hypotheses = Object.freeze(
    list(r.hypotheses, '$.hypotheses', 1).map((h, i) => hypothesis(h, `$.hypotheses[${i}]`)),
  )
  unique(
    hypotheses.map((h) => h.id),
    '$.hypotheses',
    'id',
  )
  const confirmatory = hypotheses.filter((h) => h.kind === 'confirmatory')
  if (confirmatory.length === 0) fail('$.hypotheses', 'must include a confirmatory hypothesis')
  const primary = text(r.primary, '$.primary')
  if (!confirmatory.some((h) => h.id === primary)) {
    fail('$.primary', 'must be the id of a confirmatory hypothesis')
  }
  const alpha = r.alpha
  if (typeof alpha !== 'number' || !(alpha > 0 && alpha < 1)) {
    fail('$.alpha', 'must be a number in (0, 1)')
  }
  const correction =
    r.correction === undefined ? undefined : oneOf(r.correction, '$.correction', CORRECTIONS)
  if (confirmatory.length > 1 && correction === undefined) {
    fail('$.correction', 'is required with more than one confirmatory hypothesis')
  }
  const authors =
    r.authors === undefined
      ? undefined
      : Object.freeze(list(r.authors, '$.authors', 1).map((a, i) => text(a, `$.authors[${i}]`)))
  const dataSources = Object.freeze(
    list(r.dataSources, '$.dataSources', 1).map((d, i) => dataSource(d, `$.dataSources[${i}]`)),
  )
  unique(
    dataSources.map((d) => d.name),
    '$.dataSources',
    'name',
  )
  return compact({
    title: text(r.title, '$.title'),
    authors,
    hypotheses,
    primary,
    alpha,
    correction,
    sample: sample(r.sample, '$.sample'),
    analysisPlanHash: hash(r.analysisPlanHash, '$.analysisPlanHash'),
    exclusions: Object.freeze(
      list(r.exclusions, '$.exclusions', 0).map((e, i) => text(e, `$.exclusions[${i}]`)),
    ),
    dataSources,
    blinding: optionalText(r.blinding, '$.blinding'),
    supersedes: r.supersedes === undefined ? undefined : hash(r.supersedes, '$.supersedes'),
    notes: optionalText(r.notes, '$.notes'),
  })
}

/**
 * The exact text a registration hash covers: the RFC 8785 canonical JSON of
 * `{ schema: REGISTRATION_SCHEMA, registration }` for the validated record.
 * Publish it next to the hash so anyone can recompute the digest with any
 * JCS implementation.
 *
 * @throws {LedgerError} `invalid_registration` for an invalid record; `invalid_json`
 *   when a string contains a lone surrogate or noncharacter.
 */
export function registrationCanonical(registration: Registration): string {
  return canonicalize({
    schema: REGISTRATION_SCHEMA,
    registration: validateRegistration(registration),
  })
}

/**
 * Lower-case hex SHA-256 of {@link registrationCanonical}. Use it as a chain
 * genesis (`startChain`), a psi `recordSession` registration, and the
 * `registrationHash` of a time bracket. The hash proves *what* was
 * registered; *when* needs a time bracket and publication.
 */
export async function registrationHash(registration: Registration): Promise<string> {
  return sha256Hex(registrationCanonical(registration))
}
