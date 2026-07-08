/**
 * Entropy estimators over raw bytes/bits. These can only ever FAIL a source —
 * passing proves nothing about physical unpredictability (any CSPRNG passes
 * everything). Meaningful on RAW source output; whitened output looks perfect
 * by construction.
 */

export { toBits } from '../internal/bytes.js'

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
