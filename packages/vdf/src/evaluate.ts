import { VdfError } from './errors.js'
import { hashToGroupSync } from './hash.js'
import { canon } from './internal/group.js'
import { sequentialSquare } from './internal/squaring.js'
import { assertModulus, assertT, toBytes } from './internal/validate.js'
import { PROGRESS_INTERVAL as INTERVAL, Work } from './internal/work.js'
import { RSA2048 } from './moduli.js'
import type { ProgressFn, RsaModulus, VdfCheckpoints, VdfEvaluation } from './types.js'

/** Work units (squarings) between abort checks and progress callbacks. */
export const PROGRESS_INTERVAL = INTERVAL

export interface EvaluateOptions {
  /** Group of unknown order to work in. Default {@link RSA2048}. */
  modulus?: RsaModulus
  /**
   * Cooperative cancellation: checked every {@link PROGRESS_INTERVAL}
   * squarings; the loop yields to the event loop every 16 blocks so an abort
   * fired from a timer or UI handler is actually observed. Throws
   * `VdfError('aborted')`.
   */
  signal?: AbortSignal
  /** Progress callback, `(done, T)` every {@link PROGRESS_INTERVAL} squarings and exactly once at completion. */
  onProgress?: ProgressFn
  /**
   * Store $k$ = `checkpoints` evenly spaced powers for the provers: every
   * $\lceil T/k \rceil$ squarings the current canonical power is kept, costing
   * $\approx k$ group elements of memory (no extra squarings). Integer in
   * $[1, T]$; $k \approx \sqrt{T}$ is a good default. Pass the returned
   * `checkpoints` to `pietrzakProve` / `wesolowskiProve`.
   */
  checkpoints?: number
}

/**
 * Evaluate the VDF: map the input into $QR_n^+$ and perform $T$ sequential
 * squarings,
 *
 * $$x = |H'(\mathrm{input})^2 \bmod n|, \qquad y = |x^{2^T} \bmod n| .$$
 *
 * The chain $x, x^2, x^4, \dots$ cannot be shortcut without knowing the group
 * order (Rivest–Shamir–Wagner time-lock puzzles, 1996), so the wall-clock time is
 * $\approx T / \mathrm{squaringsPerSecond}$ on the *fastest* sequential hardware,
 * regardless of parallelism. Size $T$ with `calibrate()`.
 *
 * Both $x$ and $y$ are canonical representatives $\min(a, n - a)$: the unique
 * output of the VDF. Deterministic: the same input bytes, $T$, and modulus always
 * produce the same $(x, y)$.
 *
 * @param input Seed bytes (e.g. a beacon pulse). `Uint8Array` or integer `ArrayLike`.
 * @param T Number of sequential squarings, integer in $[1, 2^{32} - 1]$.
 * @returns The frozen `{ x, y }`, plus `checkpoints` when requested.
 */
export async function evaluate(
  input: Uint8Array | ArrayLike<number>,
  T: number,
  opts: EvaluateOptions = {},
): Promise<VdfEvaluation> {
  const modulus = opts.modulus ?? RSA2048
  const n = assertModulus(modulus)
  assertT(T)
  const bytes = toBytes(input, 'input')
  const k = opts.checkpoints
  if (k !== undefined && (typeof k !== 'number' || !Number.isInteger(k) || k < 1 || k > T)) {
    throw new VdfError('invalid_input', `checkpoints must be an integer in [1, ${T}], got ${k}`)
  }
  const work = new Work(T, opts.signal, opts.onProgress)
  work.throwIfAborted()
  const x = hashToGroupSync(bytes, n)
  if (k === undefined) {
    const y = canon(await sequentialSquare(x, T, n, work), n)
    return Object.freeze({ x, y })
  }
  const interval = Math.ceil(T / k)
  const powers: bigint[] = [x]
  let current = x
  const stored = Math.floor(T / interval)
  for (let j = 1; j <= stored; j++) {
    current = canon(await sequentialSquare(current, interval, n, work), n)
    powers.push(current)
  }
  const y = canon(await sequentialSquare(current, T - stored * interval, n, work), n)
  const checkpoints: VdfCheckpoints = Object.freeze({
    T,
    interval,
    powers: Object.freeze(powers),
  })
  return Object.freeze({ x, y, checkpoints })
}
