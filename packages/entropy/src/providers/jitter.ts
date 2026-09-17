import { EntropyError } from '../errors.js'
import type { ConditioningOptions } from '../internal/condition.js'
import { requireInteger } from '../internal/options.js'
import { sleep } from '../internal/rate-limit.js'
import { sampledProvider } from '../internal/sampled.js'
import type { EntropyProvider } from '../types.js'

export interface JitterOptions extends ConditioningOptions {
  /** Timing deltas (integer ≥ 1) gathered per internal batch (event loop yields between). Default 4096. */
  batchSamples?: number
  /**
   * Opt in to the coarse browser clock (performance.now, 100µs+ granularity).
   * Coarse mode counts operations per fixed window instead of measuring
   * per-operation deltas; its entropy is real but UNQUANTIFIED — mix it via
   * xorMix, never use it as your only source.
   */
  allowCoarseClock?: boolean
}

interface HrtimeClock {
  kind: 'hrtime'
  now: () => bigint
}

interface CoarseClock {
  kind: 'coarse'
  now: () => number
}

/**
 * Resolve the best available clock without importing node: modules. Throws
 * `EntropyError('invalid_request')` when only a coarse clock exists and
 * `allowCoarse` is false, or when no usable clock exists at all.
 */
export function pickClock(
  allowCoarse: boolean,
  g: typeof globalThis = globalThis,
): HrtimeClock | CoarseClock {
  const bigint = (g as { process?: { hrtime?: { bigint?: () => bigint } } }).process?.hrtime?.bigint
  if (typeof bigint === 'function') {
    return { kind: 'hrtime', now: () => bigint() }
  }
  const perf = (g as { performance?: { now?: () => number } }).performance
  const perfNow = perf?.now
  if (typeof perfNow === 'function') {
    if (!allowCoarse) {
      throw new EntropyError(
        'invalid_request',
        'jitterEntropy: this runtime only offers a coarse clock (performance.now) — pass allowCoarseClock: true to accept unquantified supplementary entropy',
        { provider: 'jitter' },
      )
    }
    // performance.now needs its receiver — a detached call throws in browsers
    return { kind: 'coarse', now: () => perfNow.call(perf) }
  }
  throw new EntropyError(
    'invalid_request',
    'jitterEntropy: no usable high-resolution clock found in this runtime',
    { provider: 'jitter' },
  )
}

/** Deltas measured by the start-up self-test (after the cache-clearing warm-up). */
export const JITTER_STARTUP_LOOPS = 1024
/** Warm-up iterations run before the counted self-test loops (jitterentropy's CLEARCACHE). */
export const JITTER_STARTUP_CLEARCACHE = 100

/** Outcome of `jitterStartupTest`: pass/fail plus the counters behind the verdict. */
export interface JitterStartupReport {
  readonly ok: boolean
  /** Why the test failed; undefined when `ok`. */
  readonly reason?: string
  /** Counted deltas (warm-up excluded). */
  readonly samples: number
  /** Deltas equal to 0 — the clock did not advance across one iteration. */
  readonly zeroDeltas: number
  /** Deltas < 0 — the clock ran backwards. */
  readonly backwards: number
  /** Deltas divisible by 100 — the signature of a 100-ns-or-coarser timer. */
  readonly coarseDeltas: number
  /** Stuck deltas: delta, its first or its second difference is 0. */
  readonly stuck: number
  /** Σ|deltaᵢ − deltaᵢ₋₁| over the counted deltas. */
  readonly variation: number
}

/**
 * Start-up self-test over per-iteration timing deltas (in clock ticks, e.g.
 * nanoseconds), ported from jitterentropy's `jent_time_entropy_init` /
 * `jent_stuck`. The first `JITTER_STARTUP_CLEARCACHE` deltas are warm-up;
 * over the remaining N it fails when:
 *
 * - more than 3 deltas are negative (clock not monotonic);
 * - more than N/10 deltas are 0 (timer too coarse — jitterentropy fails on
 *   any zero delta; one in ten is tolerated here because JS clock reads are
 *   quantized to the platform timebase, e.g. 41.67 ns on Apple Silicon);
 * - more than 9N/10 deltas are multiples of 100 (coarse timer);
 * - more than 9N/10 deltas are stuck (delta, Δdelta or Δ²delta equal 0);
 * - Σ|Δdelta| < N (no variation to harvest).
 *
 * A pass is necessary, not sufficient: periodic patterns (e.g. two alternating
 * values) pass and are left to the continuous health tests and the credit.
 */
export function jitterStartupTest(deltas: readonly number[]): JitterStartupReport {
  let zeroDeltas = 0
  let backwards = 0
  let coarseDeltas = 0
  let stuck = 0
  let variation = 0
  let samples = 0
  let lastDelta = 0
  let lastDelta2 = 0
  for (let i = 0; i < deltas.length; i++) {
    const delta = deltas[i] as number
    const delta2 = delta - lastDelta
    const delta3 = delta2 - lastDelta2
    const isStuck = delta === 0 || delta2 === 0 || delta3 === 0
    const previous = lastDelta
    lastDelta = delta
    lastDelta2 = delta2
    if (i < JITTER_STARTUP_CLEARCACHE) continue
    samples++
    if (isStuck) stuck++
    if (delta === 0) zeroDeltas++
    if (delta < 0) backwards++
    if (delta % 100 === 0) coarseDeltas++
    variation += Math.abs(delta - previous)
  }
  const counters = { samples, zeroDeltas, backwards, coarseDeltas, stuck, variation }
  const fail = (reason: string): JitterStartupReport => ({ ok: false, reason, ...counters })
  if (samples === 0) return fail('no deltas measured')
  if (backwards > 3) return fail(`clock ran backwards ${backwards} times`)
  if (zeroDeltas > samples / 10) {
    return fail(`${zeroDeltas}/${samples} zero deltas (timer too coarse)`)
  }
  if (coarseDeltas > (samples / 10) * 9) {
    return fail(`${coarseDeltas}/${samples} deltas are multiples of 100 (coarse timer)`)
  }
  if (stuck > (samples / 10) * 9) return fail(`${stuck}/${samples} stuck deltas`)
  if (variation < samples) return fail(`delta variation ${variation} below ${samples}`)
  return { ok: true, ...counters }
}

const WALK_SIZE = 65_536
const COARSE_WINDOW_MS = 0.5
const COARSE_BATCH = 64

/**
 * CPU timing jitter (the jitterentropy concept in plain JS). With
 * process.hrtime.bigint (Node/Bun) it measures per-iteration nanosecond
 * deltas of a data-dependent memory walk, credited very conservatively at
 * 1/16 bit per delta and health-tested there (RCT cutoff 321, APT cutoff
 * 509/512). Every session first runs `jitterStartupTest` over 1024 deltas and
 * refuses with `EntropyError('health_test')` on a coarse, stuck or
 * non-monotonic clock. Software-only and unattested — prefer hardware sources
 * where available; ideal as an always-on xorMix member.
 */
export function jitterEntropy(opts: JitterOptions = {}): EntropyProvider {
  const { allowCoarseClock = false } = opts
  const batchSamples = requireInteger(opts.batchSamples ?? 4096, 'batchSamples', 1, 'jitter')
  const clock = pickClock(allowCoarseClock)

  const walk = new Uint8Array(WALK_SIZE)
  let index = 0

  function mix(i: number): void {
    index = (index * 31 + (walk[index] as number) + i) & (WALK_SIZE - 1)
    walk[index] = ((walk[index] as number) + 0x9e) & 0xff
  }

  function startupDeltas(now: () => bigint): number[] {
    const deltas: number[] = []
    let prev = now()
    for (let i = 0; i < JITTER_STARTUP_CLEARCACHE + JITTER_STARTUP_LOOPS; i++) {
      mix(i)
      const t = now()
      deltas.push(Number(t - prev))
      prev = t
    }
    return deltas
  }

  async function* hrtimeSamples(signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    const now = (clock as HrtimeClock).now
    const report = jitterStartupTest(startupDeltas(now))
    if (!report.ok) {
      throw new EntropyError('health_test', `jitter start-up self-test failed: ${report.reason}`, {
        provider: 'jitter',
      })
    }
    while (true) {
      const samples = new Uint8Array(batchSamples)
      let prev = now()
      for (let i = 0; i < batchSamples; i++) {
        mix(i)
        const t = now()
        samples[i] = Number((t - prev) & 0xffn)
        prev = t
      }
      yield samples
      await sleep(0, signal)
    }
  }

  async function* coarseSamples(signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    const now = (clock as CoarseClock).now
    while (true) {
      const samples = new Uint8Array(COARSE_BATCH)
      for (let i = 0; i < COARSE_BATCH; i++) {
        const start = now()
        let ops = 0
        while (now() - start < COARSE_WINDOW_MS) {
          mix(ops)
          ops++
        }
        samples[i] = ops & 0xff
      }
      yield samples
      await sleep(0, signal)
    }
  }

  const coarse = clock.kind === 'coarse'
  return sampledProvider(
    {
      name: coarse ? 'jitter(coarse)' : 'jitter',
      kind: 'trng',
      privacy: 'private',
      open: coarse ? coarseSamples : hrtimeSamples,
      defaultMinEntropyPerSample: coarse ? 0.01 : 0.0625,
      // Keep the APT active. hrtime: the exact cutoffs at the 1/16-bit credit
      // already give RCT 321 / APT 509 of 512 — no stricter health H, because
      // the delta distribution is non-stationary (under a busy test runner on
      // Apple Silicon one delta value filled 468 of 512 windows and repeated
      // 81× in a row; a 1/4-bit health H alarmed on such phases). coarse: at
      // its 0.01-bit credit the APT cutoff is 513 > W (cannot fire), so test
      // at 1/16 bit (APT 509).
      ...(coarse ? { defaultHealthMinEntropyPerSample: 0.0625 } : {}),
      defaultSafetyFactor: 2,
      defaultTimeoutMs: 30_000,
    },
    opts,
  )
}
