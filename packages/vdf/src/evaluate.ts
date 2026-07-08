import { hashToGroup } from './hash.js'
import { sequentialSquare } from './internal/squaring.js'
import { assertModulus, assertT, toBytes } from './internal/validate.js'
import { RSA2048 } from './moduli.js'
import type { ProgressFn, RsaModulus, VdfEvaluation } from './types.js'

/** Squarings between abort checks and progress callbacks in `evaluate` and `pietrzakProve`. */
export const PROGRESS_INTERVAL = 1024

export interface EvaluateOptions {
  /** Group of unknown order to work in. Default {@link RSA2048}. */
  modulus?: RsaModulus
  /**
   * Cooperative cancellation: checked every {@link PROGRESS_INTERVAL}
   * squarings; the loop periodically yields to the event loop so an abort
   * fired from a timer or UI handler is actually observed. Throws
   * `VdfError('aborted')`.
   */
  signal?: AbortSignal
  /** Progress callback, `(done, T)` every {@link PROGRESS_INTERVAL} squarings and at completion. */
  onProgress?: ProgressFn
}

/**
 * Evaluate the VDF: map the input into the group and perform $T$ sequential
 * squarings,
 *
 * $$x = H'(\mathrm{input})^2 \bmod n, \qquad y = x^{2^T} \bmod n .$$
 *
 * The chain $x, x^2, x^4, \dots$ cannot be shortcut without knowing the group
 * order $\varphi(n)$ (Rivest–Shamir–Wagner time-lock puzzles, 1996), so the
 * wall-clock time is $\approx T / \mathrm{squaringsPerSecond}$ on the
 * *fastest* sequential hardware, regardless of parallelism. Size $T$ with
 * `calibrate()` — squaring throughput varies by an order of magnitude across
 * deployments.
 *
 * Deterministic: the same input bytes, $T$, and modulus always produce the
 * same $(x, y)$.
 *
 * @param input Seed bytes (e.g. a beacon pulse). `Uint8Array` or integer `ArrayLike`.
 * @param T Number of sequential squarings, integer in $[1, 2^{32} - 1]$.
 * @returns The frozen pair $\{x, y\}$.
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
  const { onProgress } = opts
  const x = await hashToGroup(bytes, modulus)
  const y = await sequentialSquare(x, T, n, {
    signal: opts.signal,
    interval: PROGRESS_INTERVAL,
    onStep: onProgress === undefined ? undefined : (done) => onProgress(done, T),
  })
  onProgress?.(T, T)
  return Object.freeze({ x, y })
}
