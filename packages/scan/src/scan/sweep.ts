import { type ByteReader, uniformInt } from '@mindpeeker/oracle'
import type { Rate } from '@mindpeeker/rate'
import { openReader } from '../internal/reader.js'
import { toScanError } from '../internal/rethrow.js'
import {
  abortSignal,
  byteSource,
  integerIn,
  invalid,
  oneOf,
  optionsObject,
  scannableCatalog,
} from '../internal/validate.js'
import type { ByteSource, Catalog, EntropyAccounting } from '../types.js'

/**
 * How the operator's "stick" is replaced by chance at each sweep position:
 *
 * - `'first-passage'` — the literal sweep: at position $k$ (0-based) of $P$ a
 *   stick occurs when `uniformInt(P)` $< k + 1$, a hazard $(k+1)/P$ that rises
 *   until the last position always sticks (no overshoot).
 * - `'uniform'` — the stop position is one `uniformInt(P)` draw, the
 *   reading with every position equally likely.
 */
export type SweepModel = 'first-passage' | 'uniform'

/** A bank of identical dials, swept one after another. */
export interface SweepDials {
  /** Number of dials, swept in order starting with the dial nearest the witness well; integer in $[1, 64]$. */
  readonly dials: number
  /** Positions per dial (its base); integer in $[2, 100\,000]$. */
  readonly positions: number
}

/** Options for {@link sweepScan}. */
export interface SweepOptions {
  /** Default `'first-passage'`. */
  model?: SweepModel
  signal?: AbortSignal
}

/** The replayable outcome of a modelled sweep. */
export interface SweepReport {
  /** `'dials'` for a {@link SweepDials} target, `'catalog'` for a catalog read top to bottom. */
  readonly kind: 'dials' | 'catalog'
  readonly model: SweepModel
  /** Positions per dial, or the catalog size. */
  readonly positions: number
  /** 0-based stop position per dial in sweep order (one entry for a catalog). */
  readonly stops: readonly number[]
  /** Dials only: the stops as a rate `{ digits: stops, base: positions }`. */
  readonly rate?: Rate
  /** Catalog only: the item the sweep stopped at. */
  readonly item?: { readonly id: string; readonly name: string; readonly category?: string }
  /** Exact $P(\text{stop at } k)$, $k = 0..P-1$, for one dial under a fair source ({@link sweepNullPmf}). */
  readonly nullPmf: readonly number[]
  /** Chance probability of each observed stop, `nullPmf[stop]`, per dial. */
  readonly stopProbabilities: readonly number[]
  readonly source: string
  readonly accounting: EntropyAccounting
}

const MODELS: readonly SweepModel[] = ['first-passage', 'uniform']

/**
 * The exact null distribution of one sweep over `positions` positions:
 *
 * - `'uniform'`: $P(k) = 1/P$.
 * - `'first-passage'`:
 *   $$P(k) = \frac{k+1}{P}\prod_{j=0}^{k-1}\Big(1 - \frac{j+1}{P}\Big),$$
 *   which sums to 1 (the last position sticks with certainty) and is far from
 *   flat: $P(0) = 1/P$ while the mode sits near $\sqrt{P}$.
 *
 * @throws {ScanError} `invalid_options` for a bad size or model
 */
export function sweepNullPmf(positions: number, model: SweepModel = 'first-passage'): number[] {
  const p = integerIn(positions, 'positions', 1, 100_000)
  oneOf(model, 'model', MODELS)
  if (model === 'uniform') return new Array<number>(p).fill(1 / p)
  const pmf = new Array<number>(p)
  let survive = 1
  for (let k = 0; k < p; k++) {
    const hazard = (k + 1) / p
    pmf[k] = survive * hazard
    survive *= 1 - hazard
  }
  return pmf
}

async function sweepOne(reader: ByteReader, positions: number, model: SweepModel): Promise<number> {
  if (model === 'uniform') return uniformInt(reader, positions)
  for (let k = 0; k < positions - 1; k++) {
    if ((await uniformInt(reader, positions)) < k + 1) return k
  }
  return positions - 1
}

/**
 * An honest, replayable model of the **classical radionic sweep** — the
 * procedure AetherOne's random EV race replaced.
 *
 * In the practitioner literature a scan is an operator's sequential dial
 * sweep: the witness goes in the well, every dial starts at its lowest
 * setting, dial 1 (nearest the well) is turned slowly while the fingers stroke
 * a rubber pad, and at a "stick" the operator stops and moves to the next dial;
 * the settings are the rate. Nothing in that literature states how often a
 * stick at a given position happens by chance. `sweepScan` keeps the procedure
 * and replaces the stick with a draw of stated law ({@link SweepModel}), so
 * the reading comes with its exact null ({@link sweepNullPmf}) and replays
 * byte-for-byte from the recorded source.
 *
 * - `SweepDials` target: sweeps `dials` dials of `positions` positions each,
 *   nearest-well first; the stops form a `Rate`.
 * - `Catalog` target: reads the catalog top to bottom as one "dial" whose
 *   positions are the items, and reports the item it stopped at.
 *
 * Under `'first-passage'` a fair source favours middle positions — a sweep
 * that "keeps landing" there is showing the model, not the target. Under
 * `'uniform'` every position is equally likely. Either way the result is a
 * chance event, not a measurement.
 *
 * @throws {ScanError} `invalid_catalog`; `invalid_options` (dials, positions,
 *   model, source shape); `insufficient_entropy`; `source_error`; `aborted`
 */
export async function sweepScan(
  target: Catalog | SweepDials,
  source: ByteSource,
  opts: SweepOptions = {},
): Promise<SweepReport> {
  const o = optionsObject(opts, 'sweepScan options')
  const model = oneOf(o.model ?? 'first-passage', 'model', MODELS)
  if (typeof target !== 'object' || target === null) {
    invalid('sweepScan target must be a catalog or { dials, positions }')
  }
  const isCatalog = 'items' in target
  const catalog = isCatalog ? scannableCatalog(target) : undefined
  const dials = catalog ? 1 : integerIn((target as SweepDials).dials, 'dials', 1, 64)
  const positions = catalog
    ? catalog.items.length
    : integerIn((target as SweepDials).positions, 'positions', 2, 100_000)
  const src = byteSource(source)
  const nullPmf = sweepNullPmf(positions, model)
  const reader = openReader(src, abortSignal(o.signal))
  try {
    const stops: number[] = []
    for (let d = 0; d < dials; d++) stops.push(await sweepOne(reader, positions, model))
    const bytesConsumed = reader.bytesConsumed
    const picked = catalog?.items[stops[0] as number]
    return Object.freeze({
      kind: catalog ? 'catalog' : 'dials',
      model,
      positions,
      stops: Object.freeze(stops),
      ...(!catalog && {
        rate: Object.freeze({ digits: Object.freeze([...stops]), base: positions }),
      }),
      ...(picked !== undefined && {
        item: Object.freeze({
          id: picked.id ?? picked.name,
          name: picked.name,
          ...(picked.category !== undefined && { category: picked.category }),
        }),
      }),
      nullPmf: Object.freeze(nullPmf),
      stopProbabilities: Object.freeze(stops.map((k) => nullPmf[k] as number)),
      source: src.name,
      accounting: Object.freeze({ bytesConsumed, bitsUsed: 8 * bytesConsumed }),
    })
  } catch (error) {
    throw toScanError(error, src.name, 'sweep')
  } finally {
    await reader.close()
  }
}
