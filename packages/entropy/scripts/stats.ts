/**
 * Statistical measures for entropy-source QUALITY assessment. These can only
 * ever FAIL a source — passing proves nothing about physical unpredictability
 * (any CSPRNG passes everything). Meaningful on RAW source output; whitened
 * output looks perfect by construction.
 */

/** Shannon entropy in bits per byte (upper bound on min-entropy). */
export function shannonEntropy(data: Uint8Array): number {
  const counts = new Array<number>(256).fill(0)
  for (const byte of data) counts[byte] = (counts[byte] as number) + 1
  let h = 0
  for (const count of counts) {
    if (count === 0) continue
    const p = count / data.length
    h -= p * Math.log2(p)
  }
  return h
}

/**
 * NIST SP 800-90B §6.3.1 Most Common Value min-entropy estimate (bits/byte):
 * upper-bounds the most common symbol's probability at 99% confidence.
 */
export function mcvMinEntropy(data: Uint8Array): number {
  const counts = new Array<number>(256).fill(0)
  for (const byte of data) counts[byte] = (counts[byte] as number) + 1
  const pHat = Math.max(...counts) / data.length
  const pUpper = Math.min(1, pHat + 2.576 * Math.sqrt((pHat * (1 - pHat)) / (data.length - 1)))
  return -Math.log2(pUpper)
}

/** Unpack bytes into bits, MSB first. */
export function toBits(data: Uint8Array): Uint8Array {
  const bits = new Uint8Array(data.length * 8)
  for (let i = 0; i < data.length; i++) {
    for (let b = 0; b < 8; b++) bits[i * 8 + b] = ((data[i] as number) >> (7 - b)) & 1
  }
  return bits
}

/**
 * NIST SP 800-90B §6.3.3 Markov min-entropy estimate for binary sequences,
 * in bits per bit: the most probable 128-step path through the first-order
 * transition model bounds per-bit entropy. Catches serial dependence that
 * per-symbol counting misses (e.g. …010101… scores 0 here, 1.0 on MCV).
 */
export function markovMinEntropyPerBit(bits: Uint8Array): number {
  const n = bits.length
  if (n < 2) return 0
  let ones = 0
  const transitions = [
    [0, 0],
    [0, 0],
  ] as [number[], number[]]
  for (let i = 0; i < n; i++) {
    if (bits[i] === 1) ones++
    if (i < n - 1) {
      const row = transitions[bits[i] as 0 | 1] as number[]
      row[bits[i + 1] as 0 | 1] = (row[bits[i + 1] as 0 | 1] as number) + 1
    }
  }
  const p1 = ones / n
  const p0 = 1 - p1
  const prob = (row: number[], next: 0 | 1): number => {
    const total = (row[0] as number) + (row[1] as number)
    return total === 0 ? 0 : (row[next] as number) / total
  }
  const log2 = (p: number) => (p > 0 ? Math.log2(p) : Number.NEGATIVE_INFINITY)
  // dynamic program over the most probable 128-bit path (in log space)
  let l0 = log2(p0)
  let l1 = log2(p1)
  for (let step = 1; step < 128; step++) {
    const n0 = Math.max(l0 + log2(prob(transitions[0], 0)), l1 + log2(prob(transitions[1], 0)))
    const n1 = Math.max(l0 + log2(prob(transitions[0], 1)), l1 + log2(prob(transitions[1], 1)))
    l0 = n0
    l1 = n1
  }
  const maxLog = Math.max(l0, l1)
  if (!Number.isFinite(maxLog)) return 0
  return Math.min(1, Math.max(0, -maxLog / 128))
}

/** Chi-square statistic over the byte histogram (255 degrees of freedom). */
export function chiSquare(data: Uint8Array): { statistic: number; pValue: number } {
  const counts = new Array<number>(256).fill(0)
  for (const byte of data) counts[byte] = (counts[byte] as number) + 1
  const expected = data.length / 256
  let statistic = 0
  for (const count of counts) statistic += (count - expected) ** 2 / expected
  // Wilson–Hilferty approximation of the chi-square CDF
  const k = 255
  const z = ((statistic / k) ** (1 / 3) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k))
  return { statistic, pValue: 1 - normalCdf(z) }
}

function normalCdf(z: number): number {
  // Abramowitz–Stegun 7.1.26 erf approximation
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2)
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-(z * z) / 2)
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf)
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

/** Monte-Carlo π from 24-bit coordinate pairs (ent's classic). */
export function monteCarloPi(data: Uint8Array): number {
  let inside = 0
  let total = 0
  for (let i = 0; i + 6 <= data.length; i += 6) {
    const x =
      (((data[i] as number) << 16) | ((data[i + 1] as number) << 8) | (data[i + 2] as number)) /
      0xffffff
    const y =
      (((data[i + 3] as number) << 16) | ((data[i + 4] as number) << 8) | (data[i + 5] as number)) /
      0xffffff
    if (x * x + y * y < 1) inside++
    total++
  }
  return total === 0 ? 0 : (4 * inside) / total
}

/** gzip compression ratio: ≈1 means incompressible (as randomness should be). */
export function compressionRatio(data: Uint8Array<ArrayBuffer>): number {
  return Bun.gzipSync(data).length / data.length
}
