import type { VdfCheckpoints } from '../types.js'
import { modPow } from './bigint.js'
import { PROGRESS_INTERVAL, type Work } from './work.js'

/** Window width of the long-division prover (Wesolowski 2019, Algorithm 4 with a $2^8$ table). */
export const LONG_DIVISION_WINDOW = 8

/** Largest bucket window tried by the checkpoint (Pippenger) prover. */
const MAX_BUCKET_WINDOW = 16

/** How {@link quotientPower} will compute $x^{\lfloor 2^T/\ell \rfloor}$, with its exact work total. */
export interface QuotientPlan {
  readonly method: 'long-division' | 'buckets'
  /** Bucket window width (buckets only). */
  readonly window: number
  /** Work units the progress callback counts up to. */
  readonly units: number
}

function longDivisionUnits(T: number): number {
  return T + Math.ceil(T / LONG_DIVISION_WINDOW) + (1 << LONG_DIVISION_WINDOW)
}

/** Work units of the bucket method: per window, its squarings + one bucket insert per base + $2 \cdot 2^w$ combines. */
function bucketUnits(chunk: number, bases: number, window: number): number {
  let units = 0
  for (let bottom = 0; bottom < chunk; bottom += window) {
    const width = Math.min(window, chunk - bottom)
    units += width + bases + 2 * (1 << width)
  }
  return units
}

/**
 * Choose the cheaper way to compute $\pi = x^{\lfloor 2^T/\ell \rfloor}$: windowed
 * long division ($T$ squarings) or, with checkpoints every $c$ squarings, a
 * bucket multi-exponentiation over the $K = \lceil T/c \rceil$ stored bases.
 */
export function planQuotientPower(T: number, checkpoints?: VdfCheckpoints): QuotientPlan {
  const direct: QuotientPlan = { method: 'long-division', window: 0, units: longDivisionUnits(T) }
  if (checkpoints === undefined) return direct
  const chunk = checkpoints.interval
  const bases = Math.ceil(T / chunk)
  if (bases < 2) return direct
  let best = direct
  for (let window = 1; window <= Math.min(MAX_BUCKET_WINDOW, chunk); window++) {
    const units = bucketUnits(chunk, bases, window)
    if (units < best.units) best = { method: 'buckets', window, units }
  }
  return best
}

/**
 * $x^{\lfloor 2^T/\ell \rfloor} \bmod n$ (raw representative) by windowed long
 * division in the exponent (Wesolowski, *Efficient Verifiable Delay Functions*,
 * EUROCRYPT 2019, §4.1): keep $\rho = 2^j \bmod \ell$; per $w$-bit window,
 * $d = \lfloor 2^w \rho / \ell \rfloor$, $\rho \leftarrow 2^w \rho \bmod \ell$,
 * $\pi \leftarrow \pi^{2^w} x^d$. Invariant: after $j$ bits
 * $\pi = x^{\lfloor 2^j/\ell \rfloor}$.
 */
async function longDivision(
  x: bigint,
  T: number,
  ell: bigint,
  n: bigint,
  work: Work,
): Promise<bigint> {
  const tableSize = 1 << LONG_DIVISION_WINDOW
  const table: bigint[] = [1n]
  for (let v = 1; v < tableSize; v++) table.push(((table[v - 1] as bigint) * x) % n)
  await work.advance(tableSize)
  let rho = 1n
  let pi = 1n
  let remaining = T
  let width = T % LONG_DIVISION_WINDOW || LONG_DIVISION_WINDOW
  let pending = 0
  while (remaining > 0) {
    for (let i = 0; i < width; i++) pi = (pi * pi) % n
    const shifted = rho << BigInt(width)
    const digit = shifted / ell
    rho = shifted - digit * ell
    if (digit !== 0n) pi = (pi * (table[Number(digit)] as bigint)) % n
    remaining -= width
    pending += width + 1
    if (pending >= PROGRESS_INTERVAL) {
      await work.advance(pending)
      pending = 0
    }
    width = LONG_DIVISION_WINDOW
  }
  if (pending > 0) await work.advance(pending)
  return pi
}

/**
 * The same power from checkpoints $C_i = x^{2^{ic}}$ ($i < K$): write
 * $\lfloor 2^T/\ell \rfloor = \sum_i d_i 2^{ic}$ with $c$-bit digits
 * $d_i = \lfloor 2^{T - ic}/\ell \rfloor \bmod 2^c$, so $\pi = \prod_i C_i^{d_i}$ — a
 * multi-exponentiation evaluated with the bucket method (Pippenger 1976; the
 * "memorise every $\kappa$-th element" prover of Wesolowski 2019, §4.1). Each
 * base carries its own long-division remainder, so the $w$-bit window digits
 * $\lfloor 2^w (2^{e} \bmod \ell)/\ell \rfloor$ are produced top-down without
 * materialising the $T$-bit quotient; a window with $e < 0$ lies (almost)
 * entirely above bit $T$ and its digit is $0$ because $2^{w} < \ell$.
 */
async function buckets(
  T: number,
  ell: bigint,
  n: bigint,
  checkpoints: VdfCheckpoints,
  window: number,
  work: Work,
): Promise<bigint> {
  const chunk = checkpoints.interval
  const bases = checkpoints.powers.slice(0, Math.ceil(T / chunk))
  const remainders: (bigint | undefined)[] = bases.map(() => undefined)
  const windowBottoms: number[] = []
  for (let bottom = 0; bottom < chunk; bottom += window) windowBottoms.push(bottom)
  let acc = 1n
  for (let w = windowBottoms.length - 1; w >= 0; w--) {
    const bottom = windowBottoms[w] as number
    const width = Math.min(window, chunk - bottom)
    for (let i = 0; i < width; i++) acc = (acc * acc) % n
    const size = 1 << width
    const bucket: (bigint | undefined)[] = new Array(size)
    for (let i = 0; i < bases.length; i++) {
      const e = T - i * chunk - bottom - width
      let rho = remainders[i]
      if (rho === undefined) {
        if (e < 0) continue
        rho = modPow(2n, BigInt(e), ell)
      }
      const shifted = rho << BigInt(width)
      const digit = Number(shifted / ell)
      remainders[i] = shifted % ell
      if (digit === 0) continue
      const held = bucket[digit]
      const base = bases[i] as bigint
      bucket[digit] = held === undefined ? base : (held * base) % n
    }
    // Σ_v v·bucket_v via running products: running = ∏_{u ≥ v} bucket_u, sum = ∏_v running_v.
    let running: bigint | undefined
    let sum: bigint | undefined
    for (let v = size - 1; v >= 1; v--) {
      const held = bucket[v]
      if (held !== undefined) running = running === undefined ? held : (running * held) % n
      if (running !== undefined) sum = sum === undefined ? running : (sum * running) % n
    }
    if (sum !== undefined) acc = (acc * sum) % n
    await work.advance(width + bases.length + 2 * size)
  }
  return acc
}

/** $x^{\lfloor 2^T/\ell \rfloor} \bmod n$ following `plan` (raw representative). */
export function quotientPower(
  x: bigint,
  T: number,
  ell: bigint,
  n: bigint,
  plan: QuotientPlan,
  work: Work,
  checkpoints?: VdfCheckpoints,
): Promise<bigint> {
  if (plan.method === 'buckets' && checkpoints !== undefined) {
    return buckets(T, ell, n, checkpoints, plan.window, work)
  }
  return longDivision(x, T, ell, n, work)
}
