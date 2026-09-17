import { ScanError } from '../errors.js'
import type { BroadcastMode, BroadcastReceipt, WitnessKind } from '../types.js'

const MODES: readonly BroadcastMode[] = ['xor', 'phase', 'mask']

/** The witness kinds a receipt may record. */
export const WITNESS_KINDS: readonly WitnessKind[] = Object.freeze([
  'sample',
  'photograph',
  'signature',
  'name',
  'coordinates',
  'water',
  'symbol',
  'other',
])

const HEX64 = /^[0-9a-f]{64}$/

const V1_KEYS = new Set([
  'v',
  't',
  'target',
  'witnessHash',
  'bytesConsumed',
  'resonances',
  'rounds',
])
const V2_KEYS = new Set([...V1_KEYS, 'mode', 'witnessKind', 'outputHash'])

/**
 * Serialize a {@link BroadcastReceipt} to its canonical JSONL line (fixed key
 * order, no trailing newline). Optional keys are emitted only when present, so
 * `serializeReceipt(parseReceipt(line)) === line` for every canonical v1 or v2
 * line.
 */
export function serializeReceipt(r: BroadcastReceipt): string {
  return JSON.stringify({
    v: r.v,
    t: r.t,
    ...(r.mode !== undefined && { mode: r.mode }),
    target: r.target,
    ...(r.witnessKind !== undefined && { witnessKind: r.witnessKind }),
    ...(r.witnessHash !== undefined && { witnessHash: r.witnessHash }),
    bytesConsumed: r.bytesConsumed,
    resonances: r.resonances,
    rounds: r.rounds,
    ...(r.outputHash !== undefined && { outputHash: r.outputHash }),
  })
}

function bad(message: string, cause?: unknown): never {
  throw new ScanError('invalid_target', message, cause !== undefined ? { cause } : {})
}

/**
 * Parse and validate one JSONL broadcast-receipt line into a frozen
 * {@link BroadcastReceipt}. Accepts v2 (emitted by this version: `mode` and a
 * 64-hex `outputHash` required, `witnessKind` optional) and legacy v1 lines.
 * Strict: unknown keys, a non-finite `t`, counts that are not non-negative
 * safe integers, `resonances > rounds`, or a hash that is not 64 lowercase hex
 * digits are rejected.
 *
 * @throws {ScanError} `invalid_target` naming the fault
 */
export function parseReceipt(raw: string): BroadcastReceipt {
  if (typeof raw !== 'string') bad('receipt must be a string')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    bad('receipt is not valid JSON', cause)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    bad('receipt is not a JSON object')
  }
  const rec = parsed as Record<string, unknown>
  if (rec.v !== 1 && rec.v !== 2) bad(`receipt has unsupported version ${String(rec.v)}`)
  const v = rec.v
  const allowed = v === 1 ? V1_KEYS : V2_KEYS
  for (const key of Object.keys(rec)) {
    if (!allowed.has(key)) bad(`receipt v${v} has unknown key ${JSON.stringify(key)}`)
  }
  if (typeof rec.t !== 'number' || !Number.isFinite(rec.t))
    bad(`receipt has invalid t ${String(rec.t)}`)
  const count = (key: string): number => {
    const value = rec[key]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
      bad(`receipt has invalid ${key} ${String(value)}`)
    }
    return value
  }
  const hash = (key: string): string | undefined => {
    const value = rec[key]
    if (value === undefined) return undefined
    if (typeof value !== 'string' || !HEX64.test(value)) {
      bad(`receipt has invalid ${key} ${String(value)}`)
    }
    return value
  }
  if (typeof rec.target !== 'string' || rec.target.length === 0) {
    bad(`receipt has invalid target ${String(rec.target)}`)
  }
  const bytesConsumed = count('bytesConsumed')
  const resonances = count('resonances')
  const rounds = count('rounds')
  if (resonances > rounds) bad(`receipt has ${resonances} resonances in ${rounds} rounds`)
  const witnessHash = hash('witnessHash')
  let mode: BroadcastMode | undefined
  let witnessKind: WitnessKind | undefined
  let outputHash: string | undefined
  if (v === 2) {
    if (!MODES.includes(rec.mode as BroadcastMode))
      bad(`receipt has invalid mode ${String(rec.mode)}`)
    mode = rec.mode as BroadcastMode
    if (rec.witnessKind !== undefined) {
      if (!WITNESS_KINDS.includes(rec.witnessKind as WitnessKind)) {
        bad(`receipt has invalid witnessKind ${String(rec.witnessKind)}`)
      }
      witnessKind = rec.witnessKind as WitnessKind
    }
    outputHash = hash('outputHash')
    if (outputHash === undefined) bad('receipt v2 is missing outputHash')
  }
  return Object.freeze({
    v,
    t: rec.t,
    ...(mode !== undefined && { mode }),
    target: rec.target,
    ...(witnessKind !== undefined && { witnessKind }),
    ...(witnessHash !== undefined && { witnessHash }),
    bytesConsumed,
    resonances,
    rounds,
    ...(outputHash !== undefined && { outputHash }),
  })
}
