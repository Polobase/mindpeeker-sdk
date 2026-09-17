import { VdfError } from './errors.js'
import type { EvaluateOptions } from './evaluate.js'
import { evaluate } from './evaluate.js'
import { assertProofShape, assertT, MAX_T } from './internal/validate.js'
import { pietrzakProve, pietrzakProveCost } from './prove.js'
import type { PietrzakProof } from './types.js'
import type { VerifyOptions } from './verify.js'
import { pietrzakVerify } from './verify.js'

/**
 * A freshness seal over a beacon pulse: the delay parameter, the canonical VDF
 * output, and the Pietrzak proof that ties them to the pulse bytes.
 */
export interface BeaconSeal {
  /** Sequential squarings the seal attests to. */
  readonly T: number
  /** $y = |x^{2^T}|$ for $x = |H'(\mathrm{pulse})^2|$ — unknowable before $T$ squarings. */
  readonly y: bigint
  /** Proof that `y` really is $T$ squarings away from the pulse. */
  readonly proof: PietrzakProof
}

/**
 * Options for {@link sealBeacon}. `onProgress` receives one monotone sequence over
 * the whole seal — `(done, T + pietrzakProveCost(T, interval))` — covering the
 * evaluation and then the proof, with exactly one completion event.
 */
export interface SealOptions extends EvaluateOptions {
  /**
   * Checkpoints stored during evaluation for the prover (see
   * `EvaluateOptions.checkpoints`). Default $\lceil \sqrt{T} \rceil$, which keeps
   * $O(\sqrt{T})$ group elements in memory and removes most of the proving work.
   */
  checkpoints?: number
}

/**
 * Seal a beacon pulse behind a verifiable delay: evaluate
 * $y = |x^{2^T}|$ from $x = |H'(\mathrm{pulse})^2|$ and prove it.
 *
 * What a seal establishes — and what it does not: $y$ depends on $T$ inherently
 * sequential squarings of the pulse, so **nobody can have known $y$ earlier than
 * $T$ squarings on the fastest hardware in existence after the pulse bytes were
 * fixed** (Boneh–Bünz–Fisch, *A Survey of Two Verifiable Delay Functions*, 2018).
 * That is a *no-earlier-than* bound only: the seal proves nothing about when the
 * pulse was fixed or when $y$ was published — a "no-later-than" bound needs an
 * external witness (a beacon round, a timestamping service, a public log). And
 * the wall-clock value of $T$ is set by the adversary's hardware, not yours (see
 * `calibrate().suggestT(..., { adversarySpeedup })`).
 *
 * Cost: $T$ squarings for `evaluate` plus `pietrzakProveCost(T, interval)` for
 * the proof — with the default $\sqrt{T}$ checkpoints a small fraction of $T$.
 *
 * Composes structurally with `@mindpeeker/entropy` beacon providers — any pulse
 * bytes (NIST beacon, drand, block hashes, …) can be sealed; the packages share
 * bytes, not imports.
 *
 * @param pulse The published beacon pulse bytes.
 * @param T Delay in squarings — size it with `calibrate()` for your hardware.
 */
export async function sealBeacon(
  pulse: Uint8Array | ArrayLike<number>,
  T: number,
  opts: SealOptions = {},
): Promise<BeaconSeal> {
  assertT(T)
  const checkpoints = opts.checkpoints ?? Math.min(T, Math.ceil(Math.sqrt(T)))
  if (!Number.isInteger(checkpoints) || checkpoints < 1 || checkpoints > T) {
    throw new VdfError('invalid_input', `checkpoints must be an integer in [1, ${T}]`)
  }
  const interval = Math.ceil(T / checkpoints)
  const total = T + pietrzakProveCost(T, interval)
  const { onProgress } = opts
  const evaluation = await evaluate(pulse, T, {
    modulus: opts.modulus,
    signal: opts.signal,
    checkpoints,
    onProgress: onProgress === undefined ? undefined : (done) => onProgress(done, total),
  })
  const proof = await pietrzakProve(pulse, T, evaluation.y, {
    modulus: opts.modulus,
    signal: opts.signal,
    checkpoints: evaluation.checkpoints,
    onProgress:
      onProgress === undefined
        ? undefined
        : (done, proveTotal) => {
            if (proveTotal > 0) onProgress(T + done, total)
          },
  })
  return Object.freeze({ T, y: evaluation.y, proof })
}

/**
 * Verify a {@link BeaconSeal} against the pulse it claims to seal, in
 * $O(\log T)$ modular operations.
 *
 * Failure semantics mirror `pietrzakVerify`: an inconsistent or forged seal
 * (mismatched `seal.T`/`seal.proof.T`, mismatched `y`, a non-canonical or negated
 * `y`, out-of-range or non-integer `T` smuggled in via an untrusted seal) returns
 * `false`; only a structurally malformed seal object throws
 * `VdfError('invalid_input')`.
 */
export async function verifySeal(
  pulse: Uint8Array | ArrayLike<number>,
  seal: BeaconSeal,
  opts: VerifyOptions = {},
): Promise<boolean> {
  if (typeof seal !== 'object' || seal === null) {
    throw new VdfError('invalid_input', 'seal must be an object { T, y, proof }')
  }
  if (typeof seal.T !== 'number' || typeof seal.y !== 'bigint') {
    throw new VdfError('invalid_input', 'seal must have number T and bigint y')
  }
  assertProofShape(seal.proof)
  // T comes from untrusted seal data: out-of-range is a bad seal, not a caller bug.
  if (!Number.isInteger(seal.T) || seal.T < 1 || seal.T > MAX_T) return false
  if (seal.T !== seal.proof.T || seal.y !== seal.proof.y) return false
  return pietrzakVerify(pulse, seal.T, seal.y, seal.proof, opts)
}
