import { type BitReader, bitReader } from '@mindpeeker/oracle'
import {
  analyzeTripolar,
  type BetaPrior,
  controlContrast,
  INTENTIONS,
  type Intention,
  type RegisteredTripolar,
  type ResolvedTripolarPlan,
  type RunTripolarOptions,
  resolveTripolarPlan,
  runTripolar,
  type TripolarAnalysis,
  type TripolarContrast,
  type TripolarOrder,
  type TripolarPlan,
  type TripolarRun,
} from '@mindpeeker/psi'
import { openReader, readerView } from '../internal/reader.js'
import { toScanError } from '../internal/rethrow.js'
import {
  abortSignal,
  alphaLevel,
  betaPrior,
  byteSource,
  integerIn,
  invalid,
  optionsObject,
  scannableCatalog,
} from '../internal/validate.js'
import { accumulateDeviation, byBayesFactor, deviationStat } from '../scan/deviation.js'
import { adjustFamily } from '../scan/multiplicity.js'
import type {
  AdjustedDeviationResult,
  ByteSource,
  Catalog,
  EntropyAccounting,
  MultiplicitySummary,
  ScanResult,
} from '../types.js'

/** The yoked control arm of a {@link TripolarScanReport}. */
export interface TripolarControlReport {
  readonly source: string
  /** `analyzeTripolar` over the control arm's runs. */
  readonly analysis: TripolarAnalysis
  /** `controlContrast(experimental, control)`: does the operator's source separate more than the control? */
  readonly contrast: TripolarContrast
  readonly accounting: EntropyAccounting
}

/** Per-intention catalog scores plus the PEAR high-minus-low statistic. */
export interface TripolarScanReport {
  readonly source: string
  /** The resolved plan's intention order. */
  readonly order: TripolarOrder
  /** Intentions of the protocol runs in collection order — also the catalog-scoring block order. */
  readonly schedule: readonly Intention[]
  /**
   * The full PEAR tripolar analysis from `@mindpeeker/psi` over the
   * experimental arm. `analysis.deltaZ` is standard normal under H0.
   */
  readonly analysis: TripolarAnalysis
  /** `analysis.deltaZ`, surfaced: the high-minus-low primary statistic. */
  readonly deltaZ: number
  /** `analysis.deltaEffect`: the per-bit effect separation $\varepsilon_H - \varepsilon_L$. */
  readonly deltaEffect: number
  /** `analysis.deltaCi95`: 95% CI on `deltaEffect`. */
  readonly deltaCi95: readonly [number, number]
  /** Hash of the registration the runs were checked against, when one was given. */
  readonly registration?: string
  /** Catalog deviation scores under each intention, ranked by log Bayes factor. */
  readonly perIntention: Readonly<Record<Intention, readonly ScanResult[]>>
  /** Multiplicity over all $3M$ item tests (three intentions × $M$ items). */
  readonly multiplicity: MultiplicitySummary
  /** The control arm, when `control` was given. */
  readonly control?: TripolarControlReport
  /** Both phases on the experimental source. */
  readonly accounting: EntropyAccounting
  /** The same bytes split by phase: the tripolar protocol, then the catalog scoring. */
  readonly phaseAccounting: {
    readonly protocol: EntropyAccounting
    readonly scoring: EntropyAccounting
  }
}

/** Options for {@link scanTripolar}. */
export interface TripolarScanOptions {
  /** Deviation rounds per intention for the catalog scoring; integer ≥ 1. Default 128. */
  rounds?: number
  /** Beta prior for the per-item Bayes factors (finite shapes > 0). Default Beta(1, 1). */
  prior?: BetaPrior
  /** Family level for the multiplicity summary, in $(0, 1)$. Default 0.05. */
  alpha?: number
  /**
   * A yoked control source (e.g. a seeded CSPRNG or a recording the operator
   * cannot influence) run on the same schedule; its name must differ from
   * `source`'s. Reported as `control` with psi's `controlContrast`.
   */
  control?: ByteSource
  /** A `registerTripolar(plan)` result; runs that diverge from it reject with `invalid_options`. */
  registration?: RegisteredTripolar
  /** Required for `plan.order: 'volitional'`: the operator's per-run declaration (psi `declare`). */
  declare?: RunTripolarOptions['declare']
  signal?: AbortSignal
  /** Clock override passed through to `runTripolar`. */
  now?: () => number
}

function accounting(bytesConsumed: number, bitsUsed: number): EntropyAccounting {
  return Object.freeze({ bytesConsumed, bitsUsed })
}

/** Chunk size that lets psi's trial stream take exactly the bytes its trials need. */
function viewChunkBytes(bitsPerTrial: number): number {
  return bitsPerTrial % 8 === 0 ? bitsPerTrial / 8 : 1
}

/**
 * Score the catalog in blocks that follow the protocol's own intention
 * schedule: the $b$-th run of intention $I$ is followed (in schedule order) by
 * $\lfloor R_\text{rounds}/R \rfloor$ rounds — plus one for the first
 * $R_\text{rounds} \bmod R$ blocks — so every intention gets exactly `rounds`
 * rounds and drift is balanced as far as the plan's order balances it.
 */
async function scoreBySchedule(
  bits: BitReader,
  schedule: readonly Intention[],
  runsPerIntention: number,
  itemCount: number,
  rounds: number,
): Promise<Record<Intention, number[]>> {
  const counts: Record<Intention, number[]> = {
    high: new Array<number>(itemCount).fill(0),
    low: new Array<number>(itemCount).fill(0),
    baseline: new Array<number>(itemCount).fill(0),
  }
  const seen: Record<Intention, number> = { high: 0, low: 0, baseline: 0 }
  const base = Math.floor(rounds / runsPerIntention)
  const extra = rounds - base * runsPerIntention
  for (const intention of schedule) {
    const block = seen[intention]
    seen[intention] = block + 1
    const blockRounds = base + (block < extra ? 1 : 0)
    await accumulateDeviation(bits, itemCount, blockRounds, counts[intention])
  }
  return counts
}

/**
 * The statistically rigorous MMI scan: a **pre-registered** PEAR tripolar
 * protocol (psi's `runTripolar` + `analyzeTripolar`) for the headline
 * high-minus-low statistic, plus a fair-coin catalog deviation score under
 * each intention.
 *
 * One stream of `source` serves both phases, in order — a replayable source
 * never hands phase 2 the bytes phase 1 already used, and `accounting` covers
 * everything consumed:
 * 1. **Tripolar** — `runTripolar` collects intention-tagged runs in the plan's
 *    `order` (`'fixed'`, `'interleaved'`, `'counterbalanced'`, seeded
 *    `'instructed'`, or operator-`'volitional'` with `declare`);
 *    `analyzeTripolar` returns `deltaZ` ($\sim N(0,1)$ under H0), per-bit
 *    effects and CIs, checked against `registration` when given. With
 *    `control`, a yoked control arm runs on the same schedule and
 *    `control.contrast` reports whether the experimental separation exceeds
 *    it.
 * 2. **Catalog scoring** — the catalog's per-item fair coins are drawn in
 *    blocks that follow the *same* intention sequence the protocol used (not
 *    one fixed high → low → baseline block each), `rounds` rounds per
 *    intention; items are ranked by $\ln BF_{10}$ per intention, with
 *    Bonferroni/Holm/BH adjustment over all $3M$ tests.
 *
 * What pre-registration buys: intentions, schedule, bit budget, and
 * $p_0 = \tfrac12$ are fixed *before* the data, so a non-zero `deltaZ` is a
 * fact about the bytes — **not** proof of any mechanism, and this package
 * makes no such claim. A deviation the control arm reproduces indicts the
 * pipeline, not the operator.
 *
 * Both streams are closed when the scan ends, fails, or is aborted.
 *
 * @throws {ScanError} `invalid_catalog`; `invalid_options` (options, plan,
 *   registration mismatch); `insufficient_entropy`; `source_error`; `aborted`.
 */
export async function scanTripolar(
  catalog: Catalog,
  source: ByteSource,
  plan: TripolarPlan,
  opts: TripolarScanOptions = {},
): Promise<TripolarScanReport> {
  const o = optionsObject(opts, 'scanTripolar options')
  const cat = scannableCatalog(catalog)
  const src = byteSource(source)
  const rounds = integerIn(o.rounds ?? 128, 'rounds', 1)
  const prior = betaPrior(o.prior)
  const alpha = alphaLevel(o.alpha ?? 0.05)
  const signal = abortSignal(o.signal)
  const control = o.control === undefined ? undefined : byteSource(o.control, 'control')
  if (control !== undefined && control.name === src.name) {
    invalid('control source needs a name distinct from the experimental source')
  }
  if (o.now !== undefined && typeof o.now !== 'function') invalid('now must be a function')
  let resolved: ResolvedTripolarPlan
  try {
    resolved = resolveTripolarPlan(plan)
  } catch (error) {
    throw toScanError(error, src.name, 'tripolar plan')
  }
  const chunk = viewChunkBytes(resolved.bitsPerTrial)
  const protocolBits = 3 * resolved.runsPerIntention * resolved.trialsPerRun * resolved.bitsPerTrial

  const reader = openReader(src, signal)
  const controlReader = control === undefined ? undefined : openReader(control, signal)
  try {
    // Phase 1: the pre-registered tripolar protocol over non-closing views.
    const runs: TripolarRun[] = []
    for await (const run of runTripolar(readerView(reader, src.name, chunk), resolved, {
      ...(signal !== undefined && { signal }),
      ...(o.now !== undefined && { now: o.now }),
      ...(o.declare !== undefined && { declare: o.declare }),
      ...(control !== undefined &&
        controlReader !== undefined && {
          control: readerView(controlReader, control.name, chunk),
        }),
    })) {
      runs.push(run)
    }
    const experimental = runs.filter((r) => r.arm !== 'control')
    const registration = o.registration !== undefined ? { registration: o.registration } : {}
    const analysis = analyzeTripolar(experimental, registration)
    const protocolBytes = reader.bytesConsumed
    let controlReport: TripolarControlReport | undefined
    if (control !== undefined && controlReader !== undefined) {
      const controlAnalysis = analyzeTripolar(
        runs.filter((r) => r.arm === 'control'),
        registration,
      )
      controlReport = Object.freeze({
        source: control.name,
        analysis: controlAnalysis,
        contrast: controlContrast(analysis, controlAnalysis),
        accounting: accounting(controlReader.bytesConsumed, protocolBits),
      })
    }

    // Phase 2: catalog scoring in the protocol's own intention sequence.
    const schedule = Object.freeze(
      [...experimental].sort((a, b) => a.sequence - b.sequence).map((r) => r.intention),
    )
    const bits = bitReader(reader)
    const counts = await scoreBySchedule(
      bits,
      schedule,
      resolved.runsPerIntention,
      cat.items.length,
      rounds,
    )
    const stats = INTENTIONS.flatMap((intention) =>
      counts[intention].map((k) => deviationStat(k, rounds, prior)),
    )
    const { adjusted, summary } = adjustFamily(stats, alpha)
    const m = cat.items.length
    const perIntention = {} as Record<Intention, readonly ScanResult[]>
    INTENTIONS.forEach((intention, block) => {
      const rows = cat.items.map((item, i) => ({
        id: item.id ?? item.name,
        name: item.name,
        ...(item.category !== undefined && { category: item.category }),
        trials: rounds,
        deviation: adjusted[block * m + i] as AdjustedDeviationResult,
      }))
      rows.sort(byBayesFactor)
      perIntention[intention] = Object.freeze(
        rows.map((r, i) => Object.freeze({ ...r, rank: i + 1 })),
      )
    })

    const scoringBytes = reader.bytesConsumed - protocolBytes
    return Object.freeze({
      source: src.name,
      order: resolved.order,
      schedule,
      analysis,
      deltaZ: analysis.deltaZ,
      deltaEffect: analysis.deltaEffect,
      deltaCi95: analysis.deltaCi95,
      ...(analysis.registration !== undefined && { registration: analysis.registration }),
      perIntention: Object.freeze(perIntention),
      multiplicity: summary,
      ...(controlReport !== undefined && { control: controlReport }),
      accounting: accounting(reader.bytesConsumed, protocolBits + bits.bitsUsed),
      phaseAccounting: Object.freeze({
        protocol: accounting(protocolBytes, protocolBits),
        scoring: accounting(scoringBytes, bits.bitsUsed),
      }),
    })
  } catch (error) {
    throw toScanError(error, src.name, 'tripolar scan')
  } finally {
    await Promise.all([reader.close(), controlReader?.close()])
  }
}
