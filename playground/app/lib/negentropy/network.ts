// Building a GCP-style z-matrix from one byte draw: N sources × T steps of
// `bitsPerTrial`-bit trials, with an optional common-mode coupling that mixes
// one shared bit stream into every source. The coupling is the only synthetic
// part; the bits themselves come from the selected provider.
//
// CLIENT-ONLY: imports @mindpeeker/negentropy.

import {
  type Calibration,
  stoufferZ,
  theoreticalCalibration,
  toBits,
  trialsFromBytes,
  type TrialSeries,
  zScores,
} from '@mindpeeker/negentropy'
import { labelSeed, packBits, uniformStream } from './synth'

export interface NetworkSpec {
  /** Number of sources (≥ 2 for the pairwise statistics). */
  sources: number
  /** Steps (one trial per source per step). */
  steps: number
  /** Bits summed per trial — a multiple of 8 here, so one trial is a whole number of bytes. */
  bitsPerTrial: number
  /** Probability that a source's bit is replaced by the shared common-mode bit. */
  coupling: number
  /** Seed of the coupling pattern (not entropy). */
  seed?: number
}

export interface NetworkData {
  names: readonly string[]
  series: readonly TrialSeries[]
  calibrations: readonly Calibration[]
  /** One z row per source, step-aligned. */
  zBySource: readonly Float64Array[]
  /** Per-step Stouffer Z over all sources. */
  stouffer: Float64Array
  spec: NetworkSpec
}

/** Bytes one run consumes: every source plus the shared common-mode stream. */
export function networkBytes(spec: NetworkSpec): number {
  return (spec.sources + 1) * spec.steps * (spec.bitsPerTrial / 8)
}

/** Egg-style source names, so the tables read like a GCP network. */
export function sourceNames(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `egg-${i + 1}`)
}

/**
 * Slice one draw into per-source recordings, inject the common mode, and
 * z-score every source against its exact Binomial(k, ½) null.
 */
export function buildNetwork(bytes: Uint8Array, spec: NetworkSpec): NetworkData {
  const perTrial = spec.bitsPerTrial / 8
  const perSource = spec.steps * perTrial
  const names = sourceNames(spec.sources)
  const commonOffset = spec.sources * perSource
  const common = bytes.subarray(commonOffset, commonOffset + perSource)
  const commonBits = spec.coupling > 0 ? toBits(common) : undefined

  const series: TrialSeries[] = []
  const calibrations: Calibration[] = []
  const zBySource: Float64Array[] = []
  for (let i = 0; i < spec.sources; i++) {
    const raw = bytes.subarray(i * perSource, (i + 1) * perSource)
    const recorded = commonBits ? couple(raw, commonBits, spec) : raw
    const name = names[i] as string
    const one = trialsFromBytes(recorded, name, { bitsPerTrial: spec.bitsPerTrial })
    const cal = theoreticalCalibration(name, spec.bitsPerTrial)
    series.push(one)
    calibrations.push(cal)
    zBySource.push(zScores(one, cal))
  }
  return { names, series, calibrations, zBySource, stouffer: perStepStouffer(zBySource), spec }
}

/**
 * Replace a `coupling` fraction of one source's bits with the shared stream's.
 * The selection mask is the SAME for every source (one seed, not one per
 * source), which is what a common-mode disturbance does: it hits every device
 * at the same instants. The pairwise correlation of the z's is then ≈ the
 * coupling itself; an independently drawn mask per source would only give ≈ ρ².
 */
function couple(raw: Uint8Array, commonBits: Uint8Array, spec: NetworkSpec): Uint8Array {
  const bits = toBits(raw)
  const next = uniformStream(labelSeed('common-mode', spec.seed ?? 0x2f6e2b1))
  for (let i = 0; i < bits.length; i++) {
    if (next() < spec.coupling) bits[i] = commonBits[i] as number
  }
  return packBits(bits)
}

/** Per-step Stouffer Z = Σᵢ zᵢ/√N — the series netvar and cumulativeDeviation consume. */
export function perStepStouffer(zBySource: readonly Float64Array[]): Float64Array {
  const sources = zBySource.length
  const steps = sources === 0 ? 0 : (zBySource[0] as Float64Array).length
  const out = new Float64Array(steps)
  const column = new Float64Array(sources)
  for (let t = 0; t < steps; t++) {
    for (let i = 0; i < sources; i++) column[i] = (zBySource[i] as Float64Array)[t] as number
    out[t] = stoufferZ(column)
  }
  return out
}

/** Stouffer Z per step over every source but `exclude` — the "global" arm of onsiteVsGlobal. */
export function stoufferExcluding(zBySource: readonly Float64Array[], exclude: number): Float64Array {
  return perStepStouffer(zBySource.filter((_, i) => i !== exclude))
}

/** Netvar increments Z(t)² − 1, the series whose autocorrelation the GCP "test 3" reads. */
export function netvarIncrements(stouffer: Float64Array): Float64Array {
  const out = new Float64Array(stouffer.length)
  for (let t = 0; t < stouffer.length; t++) {
    const z = stouffer[t] as number
    out[t] = z * z - 1
  }
  return out
}
