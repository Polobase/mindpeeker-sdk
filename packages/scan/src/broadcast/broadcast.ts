import { byteReader, uniformInt } from '@mindpeeker/oracle'
import {
  formatRate,
  parseRate,
  phaseModulate,
  type Rate,
  rateMask,
  TAU,
  xorImprint,
} from '@mindpeeker/rate'
import { ScanError } from '../errors.js'
import type {
  BroadcastMode,
  BroadcastOptions,
  BroadcastReceipt,
  BroadcastTick,
  ByteSource,
  Witness,
} from '../types.js'
import { sha256Hex, signatureToRate } from './signature.js'

/** What `broadcast` accepts as a target. */
export type BroadcastTarget = Rate | Witness | string

function isRate(x: unknown): x is Rate {
  return (
    typeof x === 'object' &&
    x !== null &&
    Array.isArray((x as Rate).digits) &&
    typeof (x as Rate).base === 'number'
  )
}

/** Resolve any {@link BroadcastTarget} to a rate plus an optional witness hash. */
async function resolveTarget(
  target: BroadcastTarget,
): Promise<{ rate: Rate; witnessHash?: string }> {
  if (isRate(target)) return { rate: target }
  if (typeof target === 'string') {
    try {
      return { rate: parseRate(target), witnessHash: await sha256Hex(target) }
    } catch {
      return { rate: await signatureToRate(target), witnessHash: await sha256Hex(target) }
    }
  }
  if (typeof target === 'object' && target !== null) {
    const w = target as Witness
    const hash = w.signature
      ? await sha256Hex(w.signature)
      : w.name
        ? await sha256Hex(w.name)
        : undefined
    if (w.rate) return hash !== undefined ? { rate: w.rate, witnessHash: hash } : { rate: w.rate }
    if (w.signature)
      return { rate: await signatureToRate(w.signature), witnessHash: hash as string }
  }
  throw new ScanError(
    'invalid_target',
    'broadcast target must be a Rate, a rate string, or a witness',
  )
}

/** Modulate one raw chunk by the rate under the chosen {@link BroadcastMode}. */
async function modulateChunk(
  mode: BroadcastMode,
  rate: Rate,
  raw: Uint8Array,
): Promise<Uint8Array> {
  if (mode === 'mask') return rateMask(rate, raw.length)
  if (mode === 'phase') {
    let phases: Float64Array = new Float64Array(0)
    for await (const p of phaseModulate(raw, rate)) phases = p
    const out = new Uint8Array(phases.length)
    for (let k = 0; k < phases.length; k++) {
      out[k] = Math.round(((phases[k] as number) / TAU) * 256) % 256
    }
    return out
  }
  let out: Uint8Array = new Uint8Array(0)
  for await (const m of xorImprint(raw, rate)) out = m
  return out
}

/**
 * Broadcast a target rate by modulating a live entropy stream, faithful to the
 * AetherOne broadcast loop but with **honest DSP semantics and a receipt**.
 *
 * Each round pulls `roundBytes` bytes and rewrites them by the target rate
 * (`mode`: `'xor'` = reversible `xorImprint` (default), `'phase'` =
 * `phaseModulate`, `'mask'` = the pure `rateMask` keystream). A rare
 * **resonance** is tallied when `uniformInt(reader, resonanceOdds)` over the
 * round's own bytes hits `resonanceValue` — $\Pr \approx 1/\texttt{resonanceOdds}$,
 * default $1/6765$ (AetherOne's Fibonacci trigger). The generator yields one
 * {@link BroadcastTick} per round and **returns** a {@link BroadcastReceipt}
 * on natural completion (`rounds` reached, `durationMs` elapsed, or the source
 * ending).
 *
 * This is deterministic signal processing over an entropy stream and a
 * reproducibility receipt — nothing more. **No transmission, no
 * action-at-a-distance, and no physical effect on any subject is claimed or
 * occurs.** The "resonance" is a labelled random event with a stated rate, not
 * a detected wave.
 *
 * @throws {ScanError} `invalid_target` for an unresolvable target; `aborted`
 *   when `signal` fires.
 */
export async function* broadcast(
  target: BroadcastTarget,
  source: ByteSource,
  opts: BroadcastOptions = {},
): AsyncGenerator<BroadcastTick, BroadcastReceipt, void> {
  const { rate, witnessHash } = await resolveTarget(target)
  const mode = opts.mode ?? 'xor'
  const roundBytes = opts.roundBytes ?? 16
  const resonanceOdds = opts.resonanceOdds ?? 6765
  const resonanceValue = opts.resonanceValue ?? resonanceOdds - 1
  const now = opts.now ?? (() => Date.now())
  const hasRounds = opts.rounds !== undefined
  const hasDuration = opts.durationMs !== undefined
  const roundsLimit = hasRounds
    ? (opts.rounds as number)
    : hasDuration
      ? Number.POSITIVE_INFINITY
      : 100
  const deadline = hasDuration ? now() + (opts.durationMs as number) : Number.POSITIVE_INFINITY

  const reader = byteReader(source, opts.signal ? { signal: opts.signal } : {})
  const start = reader.bytesConsumed
  let resonances = 0
  let round = 0

  while (round < roundsLimit && now() < deadline) {
    if (opts.signal?.aborted) {
      throw new ScanError('aborted', 'broadcast aborted by caller signal', { source: source.name })
    }
    // pull one round of raw bytes; a source that ends stops the broadcast cleanly
    const raw = new Uint8Array(roundBytes)
    let ended = false
    for (let k = 0; k < roundBytes; k++) {
      try {
        raw[k] = await reader.next()
      } catch (error) {
        const code = (error as { code?: string } | null)?.code
        if (code === 'aborted') {
          throw new ScanError('aborted', 'broadcast aborted by caller signal', {
            source: source.name,
            cause: error,
          })
        }
        ended = true
        break
      }
    }
    if (ended) break

    const modulated = await modulateChunk(mode, rate, raw)
    let resonance = false
    try {
      resonance = (await uniformInt(byteReader(raw), resonanceOdds)) === resonanceValue
    } catch {
      resonance = false // a starved rejection loop over one chunk simply does not resonate
    }
    if (resonance) resonances++
    yield { round, resonance, modulated }
    round++
  }

  return Object.freeze({
    v: 1,
    t: now(),
    target: formatRate(rate),
    ...(witnessHash !== undefined && { witnessHash }),
    bytesConsumed: reader.bytesConsumed - start,
    resonances,
    rounds: round,
  })
}

/**
 * Serialize a {@link BroadcastReceipt} to its canonical JSONL line (fixed key
 * order, no trailing newline). `witnessHash` is emitted only when present, so
 * `serializeReceipt(parseReceipt(line)) === line` for canonical lines.
 */
export function serializeReceipt(r: BroadcastReceipt): string {
  return JSON.stringify({
    v: r.v,
    t: r.t,
    target: r.target,
    ...(r.witnessHash !== undefined && { witnessHash: r.witnessHash }),
    bytesConsumed: r.bytesConsumed,
    resonances: r.resonances,
    rounds: r.rounds,
  })
}

/**
 * Parse and validate one JSONL broadcast-receipt line into a frozen
 * {@link BroadcastReceipt}. Any malformed line raises `ScanError('invalid_target')`
 * naming the fault.
 */
export function parseReceipt(raw: string): BroadcastReceipt {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new ScanError('invalid_target', 'receipt is not valid JSON', { cause })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ScanError('invalid_target', 'receipt is not a JSON object')
  }
  const rec = parsed as Record<string, unknown>
  if (rec.v !== 1)
    throw new ScanError('invalid_target', `receipt has unsupported version ${String(rec.v)}`)
  const num = (key: string): number => {
    const value = rec[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ScanError('invalid_target', `receipt has invalid ${key} ${String(value)}`)
    }
    return value
  }
  if (typeof rec.target !== 'string' || rec.target.length === 0) {
    throw new ScanError('invalid_target', `receipt has invalid target ${String(rec.target)}`)
  }
  if (rec.witnessHash !== undefined && typeof rec.witnessHash !== 'string') {
    throw new ScanError(
      'invalid_target',
      `receipt has invalid witnessHash ${String(rec.witnessHash)}`,
    )
  }
  return Object.freeze({
    v: 1,
    t: num('t'),
    target: rec.target,
    ...(rec.witnessHash !== undefined && { witnessHash: rec.witnessHash as string }),
    bytesConsumed: num('bytesConsumed'),
    resonances: num('resonances'),
    rounds: num('rounds'),
  })
}
