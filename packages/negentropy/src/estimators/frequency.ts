import { chi2Sf } from '../internal/special.js'

/**
 * Chi-square statistic over the byte histogram (255 degrees of freedom),
 * with an exact incomplete-gamma p-value.
 */
export function chiSquareBytes(data: Uint8Array): { statistic: number; pValue: number } {
  const counts = new Array<number>(256).fill(0)
  for (const byte of data) counts[byte] = (counts[byte] as number) + 1
  const expected = data.length / 256
  let statistic = 0
  for (const count of counts) statistic += (count - expected) ** 2 / expected
  return { statistic, pValue: chi2Sf(statistic, 255) }
}

/** ent-style lag-1 serial correlation coefficient over bytes (0 is ideal). */
export function serialCorrelation(data: Uint8Array): number {
  const n = data.length
  let sum = 0
  let sumSq = 0
  let sumLag = 0
  for (let i = 0; i < n; i++) {
    const value = data[i] as number
    sum += value
    sumSq += value * value
    sumLag += value * (data[(i + 1) % n] as number)
  }
  const numerator = n * sumLag - sum * sum
  const denominator = n * sumSq - sum * sum
  return denominator === 0 ? 1 : numerator / denominator
}

/** Fraction of one-bits (0.5 is ideal) plus its z-score. */
export function monobit(bits: Uint8Array): { onesFraction: number; z: number } {
  let ones = 0
  for (const bit of bits) ones += bit
  const fraction = ones / bits.length
  return { onesFraction: fraction, z: (2 * ones - bits.length) / Math.sqrt(bits.length) }
}

/** Wald–Wolfowitz runs test z-score over the bit sequence. */
export function runsTest(bits: Uint8Array): number {
  const n = bits.length
  let ones = 0
  let runs = 1
  for (let i = 0; i < n; i++) {
    ones += bits[i] as number
    if (i > 0 && bits[i] !== bits[i - 1]) runs++
  }
  const zeros = n - ones
  if (ones === 0 || zeros === 0) return Number.POSITIVE_INFINITY
  const expected = (2 * ones * zeros) / n + 1
  const variance = ((expected - 1) * (expected - 2)) / (n - 1)
  return variance <= 0 ? 0 : (runs - expected) / Math.sqrt(variance)
}
