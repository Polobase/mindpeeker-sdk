import type { ConditioningOptions } from '../internal/condition.js'
import { sleep } from '../internal/rate-limit.js'
import { sampledProvider } from '../internal/sampled.js'
import type { EntropyProvider } from '../types.js'

export interface JitterOptions extends ConditioningOptions {
  /** Timing deltas gathered per internal batch (event loop yields between). Default 4096. */
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

/** Resolve the best available clock without importing node: modules. */
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
      throw new TypeError(
        'jitterEntropy: this runtime only offers a coarse clock (performance.now) — pass allowCoarseClock: true to accept unquantified supplementary entropy',
      )
    }
    // performance.now needs its receiver — a detached call throws in browsers
    return { kind: 'coarse', now: () => perfNow.call(perf) }
  }
  throw new TypeError('jitterEntropy: no usable high-resolution clock found in this runtime')
}

const WALK_SIZE = 65_536
const COARSE_WINDOW_MS = 0.5
const COARSE_BATCH = 64

/**
 * CPU timing jitter (the jitterentropy concept in plain JS). With
 * process.hrtime.bigint (Node/Bun) it measures per-iteration nanosecond
 * deltas of a data-dependent memory walk, credited very conservatively at
 * 1/16 bit per delta. Software-only and unattested — prefer hardware sources
 * where available; ideal as an always-on xorMix member.
 */
export function jitterEntropy(opts: JitterOptions = {}): EntropyProvider {
  const { batchSamples = 4096, allowCoarseClock = false } = opts
  const clock = pickClock(allowCoarseClock)

  const walk = new Uint8Array(WALK_SIZE)
  let index = 0

  function mix(i: number): void {
    index = (index * 31 + (walk[index] as number) + i) & (WALK_SIZE - 1)
    walk[index] = ((walk[index] as number) + 0x9e) & 0xff
  }

  async function* hrtimeSamples(signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    const now = (clock as HrtimeClock).now
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

  return sampledProvider(
    {
      name: clock.kind === 'coarse' ? 'jitter(coarse)' : 'jitter',
      kind: 'trng',
      privacy: 'private',
      open: clock.kind === 'coarse' ? coarseSamples : hrtimeSamples,
      defaultMinEntropyPerSample: clock.kind === 'coarse' ? 0.01 : 0.0625,
      defaultSafetyFactor: 2,
      defaultTimeoutMs: 30_000,
    },
    opts,
  )
}
