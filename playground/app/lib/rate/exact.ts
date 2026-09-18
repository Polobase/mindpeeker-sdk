// Exact reference values for the rate page: rational angles, ulp distances,
// closed-form resultant lengths, and the small statistics the demos compare
// empirical numbers against. No SDK imports — pure arithmetic.

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y !== 0) {
    const t = x % y
    x = y
    y = t
  }
  return x || 1
}

/** `d · 360/base` as an exact rational string: `'270'`, `'2970/11'`. */
export function exactDegrees(digit: number, base: number): string {
  const num = digit * 360
  const g = gcd(num, base)
  const n = num / g
  const d = base / g
  return d === 1 ? String(n) : `${n}/${d}`
}

/** `d · 2π/base` as an exact multiple of π: `'0'`, `'π/2'`, `'33π/22'`. */
export function exactRadians(digit: number, base: number): string {
  const num = 2 * digit
  if (num === 0) return '0'
  const g = gcd(num, base)
  const n = num / g
  const d = base / g
  if (d === 1) return n === 1 ? 'π' : `${n}π`
  return n === 1 ? `π/${d}` : `${n}π/${d}`
}

const ULP_BUFFER = new ArrayBuffer(8)
const ULP_F64 = new Float64Array(ULP_BUFFER)
const ULP_I64 = new BigInt64Array(ULP_BUFFER)
const INT64_MIN = -9223372036854775808n

function orderedBits(x: number): bigint {
  ULP_F64[0] = x
  const bits = ULP_I64[0] as bigint
  // Map the sign-magnitude float order onto a monotone integer order.
  return bits >= 0n ? bits : INT64_MIN - bits
}

/**
 * How many representable doubles lie between `a` and `b` — 0 when they are the
 * same double, 1 when they are neighbours. The README's claim that
 * `digitToAngle(11, 44)` is "within 1 ulp of π/2" is checkable with this.
 */
export function ulpsBetween(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.NaN
  const delta = orderedBits(a) - orderedBits(b)
  return Number(delta < 0n ? -delta : delta)
}

export interface ExactResultant {
  /** The closed-form mean resultant length. */
  readonly value: number
  /** Why that value is exact for this rate. */
  readonly why: string
}

/**
 * The closed forms that exist for a set of ring angles. Most rates have none —
 * then the honest answer is "the defining formula, evaluated in doubles".
 */
export function exactResultant(digits: readonly number[], base: number): ExactResultant | undefined {
  const n = digits.length
  if (n === 0) return undefined
  if (n === 1) return { value: 1, why: 'one angle: R̄ = |e^{iθ}| = 1 by definition' }
  const first = digits[0] as number
  if (digits.every((d) => d === first)) {
    return { value: 1, why: 'every ring on the same angle ⇒ R̄ = 1 exactly' }
  }
  if (n === 2) {
    const delta = (Math.abs((digits[1] as number) - first) * 2 * Math.PI) / base
    return {
      value: Math.abs(Math.cos(delta / 2)),
      why: 'two angles Δ apart ⇒ R̄ = |cos(Δ/2)| exactly',
    }
  }
  // A complete set of equally spaced residues sums to zero (roots of unity).
  const sorted = [...digits].sort((a, b) => a - b)
  const step = (sorted[1] as number) - (sorted[0] as number)
  if (step > 0 && step * n === base) {
    let even = true
    for (let i = 1; i < n; i++) {
      if ((sorted[i] as number) - (sorted[i - 1] as number) !== step) even = false
    }
    if (even) {
      return {
        value: 0,
        why: `${n} angles equally spaced by ${step}·2π/${base} are the ${n}-th roots of unity ⇒ they sum to 0, so R̄ = 0 exactly`,
      }
    }
  }
  return undefined
}

/**
 * Rayleigh density of the mean resultant length of `n` iid uniform angles,
 * `f(r) = 2 n r e^{-n r²}`. Exact only as n → ∞; for a five-ring rate it is an
 * approximation, and the demo says so.
 */
export function rayleighDensity(r: number, n: number): number {
  if (r < 0) return 0
  return 2 * n * r * Math.exp(-n * r * r)
}

/** Abramowitz & Stegun 7.1.26-style erfc, ~1.2e-7 absolute accuracy. */
function erfc(x: number): number {
  const z = Math.abs(x)
  const t = 1 / (1 + z / 2)
  const y =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    )
  return x >= 0 ? y : 2 - y
}

/** Two-sided normal tail `P(|Z| ≥ |z|)`. A large-sample approximation. */
export function twoSidedNormalP(z: number): number {
  if (!Number.isFinite(z)) return Number.NaN
  return Math.min(1, erfc(Math.abs(z) / Math.SQRT2))
}

/** Plug-in Shannon entropy of a count vector, in bits. */
export function plugInEntropyBits(counts: ArrayLike<number>): number {
  let total = 0
  for (let i = 0; i < counts.length; i++) total += counts[i] as number
  if (total === 0) return 0
  let h = 0
  for (let i = 0; i < counts.length; i++) {
    const c = counts[i] as number
    if (c === 0) continue
    const p = c / total
    h -= p * Math.log2(p)
  }
  return h
}

/**
 * The downward bias of the plug-in estimator on `n` samples over `k` symbols,
 * `(k − 1) / (2 n ln 2)` bits (Miller–Madow). It is why 1 kiB of perfect bytes
 * measures ≈ 7.82 bits/byte, not 8.
 */
export function plugInEntropyBias(k: number, n: number): number {
  if (n <= 0) return 0
  return (k - 1) / (2 * n * Math.LN2)
}

/** Mean and standard deviation (population) of a sample. */
export function meanAndSd(values: ArrayLike<number>): { mean: number; sd: number } {
  const n = values.length
  if (n === 0) return { mean: Number.NaN, sd: Number.NaN }
  let sum = 0
  for (let i = 0; i < n; i++) sum += values[i] as number
  const mean = sum / n
  let acc = 0
  for (let i = 0; i < n; i++) {
    const d = (values[i] as number) - mean
    acc += d * d
  }
  return { mean, sd: Math.sqrt(acc / n) }
}
