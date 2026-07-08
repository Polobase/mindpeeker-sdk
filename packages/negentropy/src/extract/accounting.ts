import { NegentropyError } from '../errors.js'
import { toBits } from '../internal/bytes.js'
import { hmacCondition, sha256Condition } from './condition.js'
import { peres, vonNeumann } from './debias.js'
import type { ToeplitzExtractor } from './toeplitz.js'

/**
 * Honest min-entropy bookkeeping through an extraction pipeline. Claims are
 * conservative and only ever shrink relative to what the bytes could hold;
 * every step records itself in the trace (mirroring EntropyResult.sources).
 */
export interface EntropyClaim {
  /** Total claimed min-entropy in bits. Invariant: 0 ≤ minEntropy ≤ 8·bytes. */
  minEntropy: number
  /** Statistical distance from uniform accumulated by extraction steps (union bound). */
  epsilon: number
  basis: 'declared' | 'measured' | 'derived'
  /** Conditions the claim rests on (e.g. iid input bits, seed independence). */
  assumptions: readonly string[]
}

export type PipelineOp =
  | 'debias:von-neumann'
  | 'debias:peres'
  | 'condition:sha256'
  | 'condition:hmac'
  | 'extract:toeplitz'

export interface PipelineStep {
  op: PipelineOp
  inBytes: number
  outBytes: number
  inMinEntropy: number
  outMinEntropy: number
}

export interface AccountedBytes {
  bytes: Uint8Array
  claim: EntropyClaim
  trace: readonly PipelineStep[]
}

/** SP 800-90B §3.1.5.1.2 vetted-conditioning output credit: min(h_in, 0.999·n_out). */
export function vettedOutputEntropy(inputMinEntropy: number, outputBits: number): number {
  return Math.min(inputMinEntropy, 0.999 * outputBits)
}

/** Start a pipeline: wrap raw bytes with a declared or measured per-byte claim. */
export function claimBytes(
  bytes: Uint8Array,
  minEntropyPerByte: number,
  basis: 'declared' | 'measured' = 'declared',
): AccountedBytes {
  if (!(minEntropyPerByte > 0 && minEntropyPerByte <= 8)) {
    throw new NegentropyError(
      'invalid_config',
      `minEntropyPerByte must be in (0, 8], got ${minEntropyPerByte}`,
    )
  }
  return {
    bytes,
    claim: {
      minEntropy: bytes.length * minEntropyPerByte,
      epsilon: 0,
      basis,
      assumptions: [`${basis} h_in = ${minEntropyPerByte} bits/byte`],
    },
    trace: [],
  }
}

/** Pack 0/1 bits MSB-first into bytes; trailing bits (<8) are dropped. */
function packBits(bits: readonly number[]): Uint8Array {
  const byteCount = Math.floor(bits.length / 8)
  const out = new Uint8Array(byteCount)
  for (let i = 0; i < byteCount; i++) {
    let value = 0
    for (let j = 0; j < 8; j++) value = (value << 1) | ((bits[i * 8 + j] as number) & 1)
    out[i] = value
  }
  return out
}

/**
 * Debias the input's BITS (von Neumann or Peres). Output bits are exactly
 * uniform under the iid-bits assumption, so the packed output gets full
 * credit — there is no distributional slack parameter, hence the assumption
 * tag rather than an epsilon. Trailing bits that don't fill a byte are
 * dropped (and not credited).
 */
export function debiasAccounted(
  input: AccountedBytes,
  method: 'von-neumann' | 'peres' = 'peres',
): AccountedBytes {
  const bits = toBits(input.bytes)
  const debiased = method === 'peres' ? peres(bits) : vonNeumann(bits)
  const bytes = packBits(debiased)
  const outMinEntropy = bytes.length * 8
  const step: PipelineStep = {
    op: method === 'peres' ? 'debias:peres' : 'debias:von-neumann',
    inBytes: input.bytes.length,
    outBytes: bytes.length,
    inMinEntropy: input.claim.minEntropy,
    outMinEntropy,
  }
  return {
    bytes,
    claim: {
      minEntropy: outMinEntropy,
      epsilon: input.claim.epsilon,
      basis: 'derived',
      assumptions: [...input.claim.assumptions, 'iid input bits (debiaser requirement)'],
    },
    trace: [...input.trace, step],
  }
}

/** SP 800-90B vetted conditioning of the whole input into one 32-byte block. */
export async function conditionAccounted(
  input: AccountedBytes,
  opts: { mode?: 'sha256' | 'hmac'; key?: Uint8Array } = {},
): Promise<AccountedBytes> {
  const mode = opts.mode ?? 'sha256'
  if (mode === 'hmac' && !opts.key) {
    throw new NegentropyError('invalid_config', 'hmac conditioning requires a key')
  }
  const bytes =
    mode === 'hmac'
      ? await hmacCondition(opts.key as Uint8Array, input.bytes)
      : await sha256Condition(input.bytes)
  const outMinEntropy = vettedOutputEntropy(input.claim.minEntropy, bytes.length * 8)
  const step: PipelineStep = {
    op: mode === 'hmac' ? 'condition:hmac' : 'condition:sha256',
    inBytes: input.bytes.length,
    outBytes: bytes.length,
    inMinEntropy: input.claim.minEntropy,
    outMinEntropy,
  }
  return {
    bytes,
    claim: {
      minEntropy: outMinEntropy,
      epsilon: input.claim.epsilon,
      basis: 'derived',
      assumptions: [...input.claim.assumptions, 'SP 800-90B vetted conditioning component'],
    },
    trace: [...input.trace, step],
  }
}

/**
 * Toeplitz extraction with leftover-hash-lemma enforcement: requires
 * claim.minEntropy ≥ outputBits + 2·log₂(1/ε). Statistical distances add
 * across composed extractions (union bound).
 */
export function extractAccounted(
  input: AccountedBytes,
  extractor: ToeplitzExtractor,
  epsilon = 2 ** -32,
): AccountedBytes {
  if (!(epsilon > 0 && epsilon < 1)) {
    throw new NegentropyError('invalid_config', `epsilon must be in (0, 1), got ${epsilon}`)
  }
  if (extractor.inputBits !== input.bytes.length * 8) {
    throw new NegentropyError(
      'invalid_config',
      `extractor expects ${extractor.inputBits} input bits, accounted input has ${input.bytes.length * 8}`,
    )
  }
  const required = extractor.outputBits + 2 * Math.log2(1 / epsilon)
  if (input.claim.minEntropy < required) {
    throw new NegentropyError(
      'invalid_config',
      `leftover hash lemma violated: need ≥ ${required} bits of min-entropy for ${extractor.outputBits} output bits at ε=${epsilon}, have ${input.claim.minEntropy}`,
    )
  }
  const bytes = extractor.extract(input.bytes)
  const step: PipelineStep = {
    op: 'extract:toeplitz',
    inBytes: input.bytes.length,
    outBytes: bytes.length,
    inMinEntropy: input.claim.minEntropy,
    outMinEntropy: extractor.outputBits,
  }
  return {
    bytes,
    claim: {
      minEntropy: extractor.outputBits,
      epsilon: input.claim.epsilon + epsilon,
      basis: 'derived',
      assumptions: [...input.claim.assumptions, 'uniform seed independent of the input'],
    },
    trace: [...input.trace, step],
  }
}
