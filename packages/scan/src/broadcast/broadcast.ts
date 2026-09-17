import { byteReader, MAX_UNIFORM, uniformInt } from '@mindpeeker/oracle'
import { formatRate, parseRate, type Rate } from '@mindpeeker/rate'
import { ScanError } from '../errors.js'
import { frozenRate, isRateLike } from '../internal/rate.js'
import { openReader } from '../internal/reader.js'
import { toScanError } from '../internal/rethrow.js'
import { Sha256, toHex } from '../internal/sha256.js'
import {
  abortSignal,
  byteSource,
  finiteAtLeast,
  integerIn,
  invalid,
  oneOf,
  optionsObject,
} from '../internal/validate.js'
import type {
  BroadcastMode,
  BroadcastOptions,
  BroadcastReceipt,
  BroadcastTick,
  ByteSource,
  Witness,
  WitnessKind,
} from '../types.js'
import { roundModulator } from './modulator.js'
import { WITNESS_KINDS } from './receipt.js'
import { sha256Hex, signatureToRate } from './signature.js'

/** What `broadcast` accepts as a target. */
export type BroadcastTarget = Rate | Witness | string

interface ResolvedTarget {
  readonly rate: Rate
  readonly witnessHash?: string
  readonly witnessKind?: WitnessKind
}

const MODES: readonly BroadcastMode[] = ['xor', 'phase', 'mask']

function nonEmptyString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ScanError('invalid_target', `${what} must be a non-empty string`)
  }
  return value
}

/**
 * Resolve any {@link BroadcastTarget} to a validated rate plus, for a witness
 * or signature, its hash and kind. A string is parsed as a rate first
 * (`'12-33-7'`, and also `'3.14'` → rate 3-14) and hashed as a signature only
 * when it is not one. Signatures are NFC-normalized before hashing.
 */
async function resolveTarget(target: unknown): Promise<ResolvedTarget> {
  if (isRateLike(target)) return { rate: frozenRate(target, 'invalid_target', 'broadcast target') }
  if (typeof target === 'string') {
    const text = nonEmptyString(target, 'broadcast target').normalize('NFC')
    let rate: Rate | undefined
    try {
      rate = parseRate(text)
    } catch {
      rate = undefined
    }
    if (rate !== undefined) return { rate: frozenRate(rate, 'invalid_target', 'broadcast target') }
    return {
      rate: await signatureToRate(text),
      witnessHash: await sha256Hex(text),
      witnessKind: 'signature',
    }
  }
  if (typeof target === 'object' && target !== null) {
    const w = target as Witness
    if (w.kind !== undefined && !WITNESS_KINDS.includes(w.kind)) {
      throw new ScanError(
        'invalid_target',
        `witness kind must be one of ${WITNESS_KINDS.join(', ')}`,
      )
    }
    const signature =
      w.signature === undefined
        ? undefined
        : nonEmptyString(w.signature, 'witness signature').normalize('NFC')
    const name = w.name === undefined ? undefined : nonEmptyString(w.name, 'witness name')
    const hashed = signature ?? name?.normalize('NFC')
    const witness =
      hashed === undefined
        ? {}
        : {
            witnessHash: await sha256Hex(hashed),
            witnessKind: w.kind ?? (signature !== undefined ? 'signature' : 'name'),
          }
    if (w.rate !== undefined) {
      return { rate: frozenRate(w.rate, 'invalid_target', 'witness rate'), ...witness }
    }
    if (signature !== undefined) return { rate: await signatureToRate(signature), ...witness }
  }
  throw new ScanError(
    'invalid_target',
    'broadcast target must be a Rate, a rate string, a signature, or a witness with a rate or signature',
  )
}

/** Bytes one `uniformInt(·, odds)` attempt reads. */
function drawBytes(odds: number): number {
  let k = 0
  for (let range = 1; range < odds; range *= 256) k++
  return k
}

function codeOf(error: unknown): unknown {
  return (error as { code?: unknown } | null)?.code
}

/**
 * Broadcast a target rate by modulating a live entropy stream, after the
 * AetherOne broadcast loop but with **honest DSP semantics and a receipt**.
 *
 * Each round pulls `roundBytes` bytes and rewrites them by the target rate as
 * **one continuous stream** (`mode`: `'xor'` = `xorImprint` (default,
 * reversible), `'phase'` = quantized `phaseModulate`, `'mask'` = the pure
 * `rateMask` keystream): the concatenated ticks equal the rate package's
 * transform of the concatenated raw rounds. A rare **resonance** is tallied
 * when `uniformInt(round, resonanceOdds)` over the round's own bytes hits
 * `resonanceValue` — probability $1/\texttt{resonanceOdds}$ per round for a
 * fair source, unless the draw's rejection loop exhausts the round (then no
 * resonance; for the default 6765 and 16-byte rounds that is below $10^{-9}$).
 * The generator yields one {@link BroadcastTick} per round and **returns** a
 * v2 {@link BroadcastReceipt} on natural completion (`rounds` reached,
 * `durationMs` elapsed, or the source ending cleanly); its `outputHash` is the
 * SHA-256 of all yielded modulated bytes, so a replay from recorded raw bytes
 * can be verified rather than trusted. A partial final round from a source
 * that ran dry is discarded (its bytes still count in `bytesConsumed`).
 *
 * **Error contract.** Only a source that *ends* (`insufficient_entropy`) ends
 * a broadcast cleanly. An abort rejects with `ScanError('aborted')`; a source
 * that *fails* — a health-test alarm from a stuck ESP32, an I/O error, a
 * non-byte chunk — rejects with `ScanError('source_error')` (provider error as
 * `cause`), never a clean-looking receipt. Options and the target are
 * validated before the source is opened; failures reject the first `next()`.
 * The source stream is closed when the broadcast completes, fails, is
 * aborted, or the consumer stops early (`return()` / `break`).
 *
 * This is deterministic signal processing over an entropy stream and a
 * reproducibility receipt — nothing more. **No transmission, no
 * action-at-a-distance, and no physical effect on any subject is claimed or
 * occurs.** The "resonance" is a labelled random event with a stated rate, not
 * a detected wave.
 *
 * @throws {ScanError} `invalid_target`, `invalid_options`, `source_error`,
 *   `aborted`
 */
export async function* broadcast(
  target: BroadcastTarget,
  source: ByteSource,
  opts: BroadcastOptions = {},
): AsyncGenerator<BroadcastTick, BroadcastReceipt, void> {
  const o = optionsObject(opts, 'broadcast options')
  const src = byteSource(source)
  const mode = oneOf(o.mode ?? 'xor', 'mode', MODES)
  const roundBytes = integerIn(o.roundBytes ?? 16, 'roundBytes', 1, 1 << 24)
  const resonanceOdds = integerIn(o.resonanceOdds ?? 6765, 'resonanceOdds', 1, MAX_UNIFORM)
  const resonanceValue = integerIn(
    o.resonanceValue ?? resonanceOdds - 1,
    'resonanceValue',
    0,
    resonanceOdds - 1,
  )
  if (roundBytes < drawBytes(resonanceOdds)) {
    invalid(
      `roundBytes ${roundBytes} cannot hold one resonance draw of odds ${resonanceOdds} (${drawBytes(resonanceOdds)} bytes)`,
    )
  }
  if (o.now !== undefined && typeof o.now !== 'function') invalid('now must be a function')
  const now = o.now ?? (() => Date.now())
  const signal = abortSignal(o.signal)
  const rounds = o.rounds === undefined ? undefined : integerIn(o.rounds, 'rounds', 0)
  const durationMs =
    o.durationMs === undefined ? undefined : finiteAtLeast(o.durationMs, 'durationMs', 0)
  const { rate, witnessHash, witnessKind } = await resolveTarget(target)
  const roundsLimit = rounds ?? (durationMs !== undefined ? Number.POSITIVE_INFINITY : 100)
  const deadline = durationMs !== undefined ? now() + durationMs : Number.POSITIVE_INFINITY

  const reader = openReader(src, signal)
  const modulator = roundModulator(mode, rate)
  const output = new Sha256()
  let resonances = 0
  let round = 0
  try {
    while (round < roundsLimit && now() < deadline) {
      if (signal?.aborted) {
        throw new ScanError('aborted', 'broadcast aborted', { source: src.name })
      }
      const raw = new Uint8Array(roundBytes)
      let ended = false
      for (let k = 0; k < roundBytes && !ended; k++) {
        try {
          raw[k] = await reader.next()
        } catch (error) {
          if (codeOf(error) !== 'insufficient_entropy') throw error
          ended = true
        }
      }
      if (ended) break

      const modulated = await modulator.modulate(raw)
      let resonance = false
      try {
        resonance = (await uniformInt(byteReader(raw), resonanceOdds)) === resonanceValue
      } catch (error) {
        // the rejection loop may exhaust the round's own bytes: no resonance
        if (codeOf(error) !== 'insufficient_entropy') throw error
      }
      output.update(modulated)
      if (resonance) resonances++
      yield { round, resonance, modulated }
      round++
    }

    return Object.freeze({
      v: 2,
      t: now(),
      mode,
      target: formatRate(rate),
      ...(witnessKind !== undefined && { witnessKind }),
      ...(witnessHash !== undefined && { witnessHash }),
      bytesConsumed: reader.bytesConsumed,
      resonances,
      rounds: round,
      outputHash: toHex(output.digest()),
    })
  } catch (error) {
    throw toScanError(error, src.name, 'broadcast')
  } finally {
    await modulator.close()
    await reader.close()
  }
}
