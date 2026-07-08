import { NegentropyError } from '../errors.js'
import type { ExperimentConfig } from './types.js'

/**
 * Canonical JSON: recursively key-sorted, Dates as ISO strings, no
 * insignificant whitespace — byte-stable across key insertion orders, so the
 * hash commits to the CONTENT of a registration.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return JSON.stringify(value)
    case 'number':
      if (!Number.isFinite(value)) {
        throw new NegentropyError('invalid_config', `non-finite number in registration: ${value}`)
      }
      return JSON.stringify(value)
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
    }
    default:
      throw new NegentropyError(
        'invalid_config',
        `unserializable value in registration: ${typeof value}`,
      )
  }
}

export interface RegisteredExperiment {
  readonly config: ExperimentConfig
  /** Hex SHA-256 of the canonical JSON — cite this alongside results. */
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

/**
 * Freeze and hash an experiment configuration BEFORE data ingestion. The
 * returned config is deeply frozen (mutation throws), and passing the
 * registration to `analyzeTrials`/`analyzeBytes`/`session` embeds its hash
 * in the result — the paper trail against garden-of-forking-paths analysis.
 */
export async function registerExperiment(config: ExperimentConfig): Promise<RegisteredExperiment> {
  const canonical = canonicalJson(config)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return { config: deepFreeze(structuredClone(config)), hash }
}
