import { NegentropyError } from '../errors.js'
import { canonicalShape, resolveExperimentConfig } from './config.js'
import type { ExperimentConfig, ResolvedExperimentConfig } from './types.js'

/** Schema tag of the hashed registration envelope. Bumped whenever the resolved shape changes. */
export const EXPERIMENT_SCHEMA = 'negentropy/experiment/1'

function reject(path: string, what: string): never {
  throw new NegentropyError(
    'invalid_config',
    `canonicalJson: ${path} is ${what} — not canonical JSON (convert it explicitly)`,
  )
}

/** RFC 7493 (I-JSON): no lone surrogates, no Unicode noncharacters. */
function checkString(value: string, path: string): void {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i)
    let codePoint = unit
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) reject(path, 'a string with a lone surrogate')
      codePoint = 0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00)
      i++
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      reject(path, 'a string with a lone surrogate')
    }
    if ((codePoint >= 0xfdd0 && codePoint <= 0xfdef) || (codePoint & 0xfffe) === 0xfffe) {
      reject(path, 'a string with a Unicode noncharacter')
    }
  }
}

function serialize(value: unknown, path: string, stack: object[]): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) reject(path, `the non-finite number ${value}`)
      return JSON.stringify(value) // ECMAScript Number::toString; −0 → "0"
    case 'string':
      checkString(value, path)
      return JSON.stringify(value)
    case 'object': {
      if (stack.includes(value)) reject(path, 'a circular reference')
      if (Array.isArray(value)) {
        stack.push(value)
        const items: string[] = []
        for (let i = 0; i < value.length; i++) {
          if (value[i] === undefined) reject(`${path}[${i}]`, 'undefined')
          items.push(serialize(value[i], `${path}[${i}]`, stack))
        }
        stack.pop()
        return `[${items.join(',')}]`
      }
      const proto: unknown = Object.getPrototypeOf(value)
      if (proto !== Object.prototype && proto !== null) {
        const name = (value as { constructor?: { name?: string } }).constructor?.name ?? 'object'
        reject(path, `a ${name}`)
      }
      stack.push(value)
      const record = value as Record<string, unknown>
      const members = Object.keys(record)
        .sort() // UTF-16 code-unit order, as RFC 8785 §3.2.3 requires
        .map((key) => {
          const child = `${path}.${key}`
          checkString(key, child)
          if (record[key] === undefined) reject(child, 'undefined')
          return `${JSON.stringify(key)}:${serialize(record[key], child, stack)}`
        })
      stack.pop()
      return `{${members.join(',')}}`
    }
    default:
      return reject(path, `a ${typeof value}`)
  }
}

/**
 * Canonical JSON per RFC 8785 (JCS): object members sorted by UTF-16 code
 * units, numbers in ECMAScript shortest round-trip form (−0 → `0`), strings
 * escaped as `JSON.stringify` does (the RFC 8785 rules), no insignificant
 * whitespace. Input must be I-JSON (RFC 7493), so everything JSON cannot
 * represent losslessly is REJECTED with `invalid_config` naming its path:
 * NaN/±Infinity, `undefined` (also as an object member or array element),
 * BigInt, functions, symbols, lone surrogates and noncharacters in strings,
 * circular references, and every non-plain object — Date, Map, Set, RegExp,
 * typed arrays, class instances. Convert those explicitly (a Date via
 * `toISOString()`); nothing is silently coerced.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, '$', [])
}

export interface RegisteredExperiment {
  /** Always `EXPERIMENT_SCHEMA`. */
  readonly schema: typeof EXPERIMENT_SCHEMA
  /** The default-resolved config, deeply frozen — what sessions and analyses run. */
  readonly config: ResolvedExperimentConfig
  /**
   * The exact bytes hashed (as UTF-8): `canonicalJson({ schema, config })`
   * with Date bounds as ISO 8601 strings. Any RFC 8785 implementation
   * reproduces it from `JSON.parse(canonical)`.
   */
  readonly canonical: string
  /** Hex SHA-256 of `canonical` — cite this alongside results. */
  readonly hash: string
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
  }
  return value
}

/** Canonical envelope string of a resolved config. */
export function registrationCanonical(config: ResolvedExperimentConfig): string {
  return canonicalJson({ schema: EXPERIMENT_SCHEMA, config: canonicalShape(config) })
}

/** True for anything shaped like a `registerExperiment` result. */
export function isRegistration(value: unknown): value is RegisteredExperiment {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { hash?: unknown }).hash === 'string' &&
    typeof (value as { config?: unknown }).config === 'object'
  )
}

/**
 * Throw `invalid_config` unless the registration is intact: produced by
 * `registerExperiment` (schema + canonical present) and its config still
 * serializes to the hashed canonical string (Date objects stay mutable
 * through `setTime` even when frozen — this catches that).
 */
export function assertRegistrationIntact(registration: RegisteredExperiment): void {
  if (registration.schema !== EXPERIMENT_SCHEMA || typeof registration.canonical !== 'string') {
    throw new NegentropyError(
      'invalid_config',
      `not a ${EXPERIMENT_SCHEMA} registration — create it with registerExperiment()`,
    )
  }
  if (registrationCanonical(registration.config) !== registration.canonical) {
    throw new NegentropyError(
      'invalid_config',
      'registration config was modified after hashing — its hash no longer describes it',
    )
  }
}

/**
 * Validate, resolve and hash an experiment configuration BEFORE data
 * ingestion. Validation is strict: unique event ids, well-formed windows
 * (`invalid_window`), trial width ≥ 8, calibration trials ≥ 2, valid
 * calibrations with unique sources at the registered width, valid anchors,
 * and no unknown keys (`invalid_config`). Every default is filled in, then
 * the versioned envelope
 * `{"schema":"negentropy/experiment/1","config":<resolved>}` is serialized
 * with `canonicalJson` (Date bounds as ISO strings) and hashed with SHA-256 —
 * so a config written with or without explicit defaults hashes identically,
 * and a later change of a library default cannot change what a hash
 * certifies. Optional `anchors.beacons` commit public beacon pulses.
 *
 * The returned `config` is the resolved config, deeply frozen; passing the
 * registration to `analyzeTrials`/`analyzeBytes`/`session` embeds `hash` in
 * the result — the paper trail against garden-of-forking-paths analysis.
 * Hashes differ from 0.1.x (which hashed the raw config without envelope).
 */
export async function registerExperiment(config: ExperimentConfig): Promise<RegisteredExperiment> {
  const resolved = resolveExperimentConfig(config)
  const canonical = registrationCanonical(resolved)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return Object.freeze({
    schema: EXPERIMENT_SCHEMA,
    config: deepFreeze(resolved),
    canonical,
    hash,
  })
}
