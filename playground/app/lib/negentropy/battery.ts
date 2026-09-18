// The quality battery as data: one row per estimator, with the exact reference
// value next to the measured one and a line saying how to read it.
//
// CLIENT-ONLY: imports @mindpeeker/negentropy.

import {
  approximateEntropy,
  chiSquareBytes,
  markovMinEntropyPerBit,
  mcvMinEntropy,
  monobit,
  normalP,
  runsTest,
  sampleEntropy,
  serialCorrelation,
  shannonEntropy,
  spectralTest,
} from '@mindpeeker/negentropy'
import { fmtNum } from '~/lib/format'

export interface BatteryRow {
  name: string
  /** The exact call this row ran. */
  api: string
  value: string
  /** The exact null/reference value the measurement should be read against. */
  reference: string
  p?: number
  pKind?: 'exact' | 'pointwise'
  note: string
}

const num = (value: number, digits: number): string => fmtNum(value, { digits })

/** Every row except the negentropy estimators, which have their own panel. */
export function buildBattery(
  bytes: Uint8Array,
  bits: Uint8Array,
  probit: Float64Array,
  subsample: number,
): BatteryRow[] {
  const chi = chiSquareBytes(bytes)
  const mono = monobit(bits)
  const runs = runsTest(bits)
  const nist = spectralTest(bits, { variance: 'nist' })
  const kim = spectralTest(bits, { variance: 'kim2004' })
  const prefix = probit.subarray(0, subsample)
  const serialBand = 1.96 / Math.sqrt(bytes.length)
  const shannonExpectation = 8 - 255 / (2 * bytes.length * Math.LN2)

  return [
    {
      name: 'Shannon entropy',
      api: 'shannonEntropy(bytes)',
      value: `${num(shannonEntropy(bytes), 4)} bits/byte`,
      reference: `finite-sample expectation ≈ ${num(shannonExpectation, 4)}, not 8`,
      note: 'The plug-in estimator is biased low by 255/(2n·ln2) — 7.955 at 4 KiB, 7.997 at 64 KiB. An upper bound on min-entropy, never a proof of unpredictability: a counter passes it.',
    },
    {
      name: 'Most Common Value min-entropy',
      api: 'mcvMinEntropy(bytes)',
      value: `${num(mcvMinEntropy(bytes), 3)} bits/byte`,
      reference: 'SP 800-90B §6.3.1 — a 99% upper bound on p_max',
      note: 'A conservative bound that tightens with data: ≈6.6 at 4 KiB, ≈7.5 at 64 KiB even for a perfect source.',
    },
    {
      name: 'Markov min-entropy',
      api: 'markovMinEntropyPerBit(bits)',
      value: `${num(markovMinEntropyPerBit(bits), 4)} bits/bit`,
      reference: 'ideal 1; a clean sample lands at 0.98–0.999',
      note: 'SP 800-90B §6.3.3 — the one estimator here that sees serial dependence: …010101… scores 0 while MCV scores 1.',
    },
    {
      name: 'Byte-histogram χ²',
      api: 'chiSquareBytes(bytes)',
      value: `χ² = ${num(chi.statistic, 1)} on 255 df`,
      reference: 'E[χ²] = 255, sd = √510 ≈ 22.6',
      p: chi.pValue,
      pKind: 'exact',
      note: 'Exact χ² tail, no normal approximation. Uniform bytes make this p uniform in [0, 1] — a p of 0.02 is not a finding.',
    },
    {
      name: 'Serial correlation (lag 1)',
      api: 'serialCorrelation(bytes)',
      value: num(serialCorrelation(bytes), 5),
      reference: `ideal 0 · white-noise band ±${num(serialBand, 4)}`,
      note: 'The ent-style lag-1 correlation of consecutive byte values.',
    },
    {
      name: 'Monobit',
      api: 'monobit(bits)',
      value: `z = ${num(mono.z, 3)} · ones ${num(mono.onesFraction * 100, 3)}%`,
      reference: 'ideal z = 0, ones 50%',
      p: normalP(mono.z, 'two'),
      pKind: 'pointwise',
      note: 'The bluntest test: it sees a one-bit excess and nothing else. Stickiness alone leaves it untouched.',
    },
    {
      name: 'Runs (Wald–Wolfowitz)',
      api: 'runsTest(bits)',
      value: `z = ${num(runs, 3)}`,
      reference: 'ideal z = 0 · +∞ for a constant sequence',
      p: normalP(runs, 'two'),
      pKind: 'pointwise',
      note: 'Too few runs ⇒ sticky bits; too many ⇒ over-alternation. The stickiness slider shows up here first.',
    },
    {
      name: 'Spectral DFT — variance: nist',
      api: "spectralTest(bits, { variance: 'nist' })",
      value: `d = ${num(nist.statistic, 3)}`,
      reference: 'SP 800-22 §2.6 with n·0.95·0.05/4',
      p: nist.pValue,
      pKind: 'pointwise',
      note: 'The /4 variance is ~5% too small, so under H0 this d is over-dispersed (sd ≈ 1.026) and its tail is anti-conservative.',
    },
    {
      name: 'Spectral DFT — variance: kim2004',
      api: "spectralTest(bits, { variance: 'kim2004' })",
      value: `d = ${num(kim.statistic, 3)}`,
      reference: 'Kim–Umeno–Hasegawa correction, /3.8',
      p: kim.pValue,
      pKind: 'pointwise',
      note: 'Same counts, honest variance: d shrinks by √(1.9/2) ≈ 0.974 and the p-value grows (d = 2.5 gives 0.0124 with /4 but 0.0148 with /3.8).',
    },
    {
      name: 'Approximate entropy',
      api: 'approximateEntropy(probit, 2)',
      value: num(approximateEntropy(prefix, 2), 4),
      reference: `on the first ${subsample} probit samples (ApEn is O(N²))`,
      note: 'ApEn (Pincus 1991) counts self-matches, so it is biased toward regularity at small N.',
    },
    {
      name: 'Sample entropy',
      api: 'sampleEntropy(probit, 2)',
      value: num(sampleEntropy(prefix, 2), 4),
      reference: 'iid normal sits near 2.2 at m = 2, r = 0.2·sd',
      note: 'SampEn excludes self-matches — less biased than ApEn and largely record-length independent.',
    },
  ]
}
