import { VdfError } from './errors.js'
import type { EvaluateOptions } from './evaluate.js'
import { evaluate } from './evaluate.js'
import { assertProofShape, MAX_T } from './internal/validate.js'
import { pietrzakProve } from './prove.js'
import type { PietrzakProof } from './types.js'
import type { VerifyOptions } from './verify.js'
import { pietrzakVerify } from './verify.js'

/**
 * A freshness seal over a beacon pulse: the delay parameter, the VDF output,
 * and the Pietrzak proof that ties them to the pulse bytes.
 */
export interface BeaconSeal {
  /** Sequential squarings the seal attests to. */
  readonly T: number
  /** $y = H'(\mathrm{pulse})^{2 \cdot 2^T} \bmod n$ — unknowable before the delay elapsed. */
  readonly y: bigint
  /** Proof that `y` really is $T$ squarings away from the pulse. */
  readonly proof: PietrzakProof
}

export interface SealOptions extends EvaluateOptions {}

/**
 * Seal a beacon pulse behind a verifiable delay: evaluate
 * $y = x^{2^T} \bmod n$ from $x = H'(\mathrm{pulse})^2$ and prove it.
 *
 * Threat model (why compose a beacon with a VDF at all): a public randomness
 * beacon can be *published* at time $t_0$, yet its operator knew the value
 * earlier and could have front-run consumers. A VDF seal removes that edge —
 * $y$ depends on $T$ *inherently sequential* squarings of the pulse, so
 * **nobody, regardless of parallelism or foreknowledge of the pulse, can know
 * $y$ earlier than $\approx T/\mathrm{sps}$ wall-clock seconds after the
 * pulse bytes were fixed** (Boneh–Bünz–Fisch, *A Survey of Two Verifiable
 * Delay Functions*, 2018; the unpredictability-despite-parallelism property
 * of Pietrzak's VDF). Anyone can then check the seal in $O(\log T)$ time.
 *
 * Cost: $\approx 2T$ squarings total — $T$ for `evaluate` plus $\approx T$
 * midpoint recomputation in `pietrzakProve` (see the recompute-vs-checkpoint
 * note there).
 *
 * Composes structurally with `@mindpeeker/entropy` beacon providers — any
 * pulse bytes (NIST beacon, drand, block hashes, …) can be sealed; the
 * packages share bytes, not imports.
 *
 * @param pulse The published beacon pulse bytes.
 * @param T Delay in squarings — size it with `calibrate()` for your hardware.
 */
export async function sealBeacon(
  pulse: Uint8Array | ArrayLike<number>,
  T: number,
  opts: SealOptions = {},
): Promise<BeaconSeal> {
  const { y } = await evaluate(pulse, T, opts)
  const proof = await pietrzakProve(pulse, T, y, opts)
  return Object.freeze({ T, y, proof })
}

/**
 * Verify a {@link BeaconSeal} against the pulse it claims to seal, in
 * $O(\log T)$ modular operations.
 *
 * Failure semantics mirror `pietrzakVerify`: an inconsistent or forged seal
 * (mismatched `seal.T`/`seal.proof.T`, mismatched `y`, out-of-range or
 * non-integer `T` smuggled in via an untrusted seal) returns `false`; only a
 * structurally malformed seal object throws `VdfError('invalid_input')`.
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
