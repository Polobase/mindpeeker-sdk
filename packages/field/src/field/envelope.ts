import { FieldError } from '../errors.js'
import { drawNullFields, type FieldInput } from '../internal/draw.js'
import {
  checkInteger,
  checkOptions,
  checkRadii,
  checkRuns,
  checkSignal,
} from '../internal/validate.js'
import {
  type EntropyAccounting,
  type FieldRegion,
  type Point,
  validatePoints,
  validateRegion,
} from '../types.js'
import { checkCurves, globalTests, type MadTest, type RankEnvelopeTest } from './global-envelope.js'
import { type KCorrection, type KDenominator, ripleyK } from './ripley.js'

/** The simulated CSR band of $\hat L(r) - r$ (0.1 fields plus curves and accounting). */
export interface CsrEnvelope {
  /** Pointwise minimum of the simulated curves. */
  readonly lo: Float64Array
  /**
   * Pointwise maximum. An observed value outside [lo, hi] at **one radius
   * fixed in advance** is significant at ≈ 2/(runs+1); scanning several radii
   * inflates the error rate — use the global test.
   */
  readonly hi: Float64Array
  readonly runs: number
  readonly radii: Float64Array
  /** Pointwise mean of the simulated curves. */
  readonly mean: Float64Array
  /** Every simulated $\hat L(r) - r$ curve, in draw order. */
  readonly simulations: readonly Float64Array[]
  /** Entropy the simulations spent. */
  readonly accounting: EntropyAccounting
}

/** {@link csrEnvelope} with the observed pattern: band, pointwise and global tests. */
export interface CsrEnvelopeTest extends CsrEnvelope {
  /** $\hat L(r) - r$ of the observed points (same estimator as the simulations). */
  readonly observed: Float64Array
  /** Pointwise two-sided Monte-Carlo p per radius (valid for one pre-chosen radius only). */
  readonly pointwiseP: Float64Array
  /** Global tests over all radii at once — `p` is the rank test's ERL p. */
  readonly global: {
    readonly p: number
    readonly rank: RankEnvelopeTest
    readonly mad: MadTest
  }
  readonly correction: KCorrection
  readonly denominator: KDenominator
}

export interface CsrEnvelopeOptions {
  /** Simulated CSR fields. Default 99; Myllymäki et al. recommend ≥ 2499 for a stable global envelope. */
  runs?: number
  signal?: AbortSignal
  /** K estimator edge correction. Default `'none'` (0.1's `ripleyL`). */
  correction?: KCorrection
  /** K normalisation. Default `'n2'` (0.1's `ripleyL`). */
  denominator?: KDenominator
  /** Level of the global rank envelope band `global.rank.lower/upper`. Default 0.05. */
  alpha?: number
}

function envelopeOf(
  simulations: readonly Float64Array[],
  d: number,
): Pick<CsrEnvelope, 'lo' | 'hi' | 'mean'> {
  const lo = new Float64Array(d).fill(Number.POSITIVE_INFINITY)
  const hi = new Float64Array(d).fill(Number.NEGATIVE_INFINITY)
  const mean = new Float64Array(d)
  for (const c of simulations) {
    for (let k = 0; k < d; k++) {
      const v = c[k] as number
      if (v < (lo[k] as number)) lo[k] = v
      if (v > (hi[k] as number)) hi[k] = v
      mean[k] = (mean[k] as number) + v
    }
  }
  for (let k = 0; k < d; k++) mean[k] = (mean[k] as number) / simulations.length
  return { lo, hi, mean }
}

async function simulate(
  source: FieldInput,
  n: number,
  region: FieldRegion,
  radii: Float64Array,
  runs: number,
  estimator: { correction: KCorrection; denominator: KDenominator },
  signal: AbortSignal | undefined,
  observed: readonly Point[] | undefined,
): Promise<{ simulations: Float64Array[]; accounting: EntropyAccounting }> {
  const simulations: Float64Array[] = []
  const list = Array.from(radii)
  const accounting = await drawNullFields(source, n, region, runs, {
    signal,
    observed,
    onField: (points) => {
      simulations.push(ripleyK(points, region, list, estimator).centered)
    },
  })
  return { simulations, accounting }
}

/**
 * Monte-Carlo complete-spatial-randomness test of Besag's $\hat L(r) - r$.
 *
 * Takes the **observed points**, computes their curve, draws `runs` CSR
 * fields of the same size from `source` (one advancing reader, so the fields
 * use disjoint bytes) and returns the simulated curves, the pointwise band,
 * the pointwise p per radius, and two **global** tests with a single p over
 * all radii: the extreme-rank envelope (Myllymäki et al. 2017; ERL p) and
 * the maximum-absolute-deviation test (Diggle 1979; Baddeley, Diggle,
 * Hardegen, Lawrence, Milne & Nair 2014). The pointwise band answers "is r
 * = r₀ unusual" for one radius fixed in advance; reading it across radii
 * inflates the error rate (≈ 0.10 family-wise at 6 radii for a nominal
 * 0.05), which is what the global p corrects.
 *
 * If a simulated field equals the observed one — the observed field was
 * drawn from the same recorded batch or a source whose `stream()` restarts
 * — the test would have no power, so this throws `invalid_config`. Draw the
 * observed field and the simulations from one shared `ByteReader`, or give
 * the simulations fresh bytes.
 *
 * @throws FieldError `invalid_config` (region, radii, runs, options, input
 *   shape, replayed field), `insufficient_data` (< 2 points; undefined
 *   curve values), `insufficient_entropy`, `aborted`, `source_error`
 */
export function csrEnvelope(
  observed: readonly Point[],
  source: FieldInput,
  region: FieldRegion,
  radii: readonly number[],
  opts?: CsrEnvelopeOptions,
): Promise<CsrEnvelopeTest>
/**
 * @deprecated 0.1 form: a band from `runs` fields of `count` points with no
 * observed curve and no global test, and no protection against a replayed
 * field. Use `csrEnvelope(observedPoints, source, region, radii, { runs })`.
 */
export function csrEnvelope(
  source: FieldInput,
  count: number,
  region: FieldRegion,
  radii: readonly number[],
  runs?: number,
  opts?: { signal?: AbortSignal },
): Promise<CsrEnvelope>
export async function csrEnvelope(
  first: readonly Point[] | FieldInput,
  second: FieldInput | number,
  region: FieldRegion,
  radii: readonly number[],
  third?: CsrEnvelopeOptions | number,
  legacyOpts: { signal?: AbortSignal } = {},
): Promise<CsrEnvelope | CsrEnvelopeTest> {
  if (typeof second === 'number') {
    const runs = checkRuns(third ?? 99)
    const count = checkInteger(second, 'count', 2, 10_000_000)
    validateRegion(region)
    const r = checkRadii(radii)
    checkOptions(legacyOpts, 'csrEnvelope')
    const signal = checkSignal(legacyOpts.signal)
    const estimator = { correction: 'none', denominator: 'n2' } as const
    const sim = await simulate(
      first as FieldInput,
      count,
      region,
      r,
      runs,
      estimator,
      signal,
      undefined,
    )
    return Object.freeze({
      ...envelopeOf(sim.simulations, r.length),
      runs,
      radii: r,
      simulations: Object.freeze(sim.simulations),
      accounting: sim.accounting,
    })
  }
  const observed = first as readonly Point[]
  validateRegion(region)
  validatePoints(observed, region, 2, 'observed')
  const r = checkRadii(radii)
  checkOptions(third ?? {}, 'csrEnvelope')
  const opts = (third ?? {}) as CsrEnvelopeOptions
  const runs = checkRuns(opts.runs ?? 99)
  const signal = checkSignal(opts.signal)
  const alpha = opts.alpha ?? 0.05
  if (typeof alpha !== 'number' || !(alpha > 0 && alpha < 1)) {
    throw new FieldError('invalid_config', `alpha must be in (0, 1), got ${String(alpha)}`)
  }
  const estimator = {
    correction: opts.correction ?? 'none',
    denominator: opts.denominator ?? 'n2',
  }
  const observedCurve = ripleyK(observed, region, Array.from(r), estimator).centered
  checkCurves([observedCurve], r)
  const sim = await simulate(second, observed.length, region, r, runs, estimator, signal, observed)
  const curves = [observedCurve, ...sim.simulations]
  checkCurves(curves, r)
  const tests = globalTests(curves, alpha)
  return Object.freeze({
    ...envelopeOf(sim.simulations, r.length),
    runs,
    radii: r,
    simulations: Object.freeze(sim.simulations),
    accounting: sim.accounting,
    observed: observedCurve,
    pointwiseP: tests.pointwiseP,
    global: Object.freeze({ p: tests.rank.p, rank: tests.rank, mad: tests.mad }),
    correction: estimator.correction,
    denominator: estimator.denominator,
  })
}
