import { NegentropyError } from '../errors.js'
import { toBits } from '../internal/bytes.js'
import { hmacCondition, sha256Condition } from './condition.js'
import { peres, vonNeumann } from './debias.js'
import type { ToeplitzExtractor } from './toeplitz.js'

/**
 * Honest min-entropy bookkeeping through an extraction pipeline. Claims are
 * conservative: no step ever raises the claim it received (a deterministic
 * map cannot add min-entropy), and no claim exceeds 8 bits per byte held.
 * Every step records itself in the trace (mirroring EntropyResult.sources).
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

const LOG2_LN2 = Math.log2(Math.LN2)

/** log₂(2^u + 2^v) without overflow. */
function log2AddExp(u: number, v: number): number {
  if (u === Number.NEGATIVE_INFINITY) return v
  if (v === Number.NEGATIVE_INFINITY) return u
  const hi = Math.max(u, v)
  return hi + Math.log1p(2 ** -Math.abs(u - v)) / Math.LN2
}

function requireBits(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new NegentropyError('invalid_config', `${name} must be a positive integer, got ${value}`)
  }
}

/**
 * NIST SP 800-90B §3.1.5.1.2 `Output_Entropy(n_in, n_out, nw, h_in)`: the
 * min-entropy (bits) of a conditioning component's n_out-bit output given
 * n_in input bits carrying h_in bits of min-entropy and narrowest internal
 * width nw:
 * $$P_{high} = 2^{-h_{in}},\quad P_{low} = \frac{1-P_{high}}{2^{n_{in}}-1},\quad
 *   n = \min(n_{out}, nw)$$
 * $$\psi = 2^{n_{in}-n}P_{low} + P_{high},\quad
 *   U = 2^{n_{in}-n} + \sqrt{2n\,2^{n_{in}-n}\ln 2},\quad \omega = U\,P_{low}$$
 * $$h_{out} = -\log_2 \max(\psi, \omega)$$
 * Evaluated entirely in the log₂ domain, so n_in of millions of bits works.
 * The result never exceeds min(h_in, n) (clamped against rounding).
 * Examples: (512, 256, 256, 256) → 255.0; (8000, 256, 256, 255) → 254.415;
 * (256, 256, 256, 256) → 251.7 (the ω multicollision term).
 */
export function outputEntropy(nIn: number, nOut: number, nw: number, hIn: number): number {
  requireBits('nIn', nIn)
  requireBits('nOut', nOut)
  requireBits('nw', nw)
  if (typeof hIn !== 'number' || !Number.isFinite(hIn) || hIn < 0 || hIn > nIn) {
    throw new NegentropyError('invalid_config', `hIn must be in [0, nIn = ${nIn}], got ${hIn}`)
  }
  const n = Math.min(nOut, nw)
  const shift = nIn - n // log₂ 2^(n_in − n)
  const log2PHigh = -hIn
  // log₂(1 − 2^−h) and log₂(2^n_in − 1), both cancellation-free
  const log2OneMinusPHigh =
    hIn === 0 ? Number.NEGATIVE_INFINITY : Math.log(-Math.expm1(-hIn * Math.LN2)) / Math.LN2
  const log2Denominator = nIn + Math.log1p(-(2 ** -nIn)) / Math.LN2
  const log2PLow = log2OneMinusPHigh - log2Denominator
  const log2Psi = log2AddExp(shift + log2PLow, log2PHigh)
  // U = 2^shift + √(2n·ln2)·2^(shift/2)
  const log2U = log2AddExp(shift, 0.5 * (1 + Math.log2(n) + LOG2_LN2) + shift / 2)
  const log2Omega = log2U + log2PLow
  const hOut = -Math.max(log2Psi, log2Omega)
  return Math.max(0, Math.min(hOut, hIn, n))
}

/**
 * Output credit for a vetted conditioning component (SHA-256, HMAC-SHA-256):
 * min(Output_Entropy(n_in, n_out, nw, h_in), 0.999·n_out).
 *
 * The 0.999·n_out cap is the §3.1.5.2 non-vetted rule, kept as a conservative
 * house policy (the standard lets vetted components claim full entropy under
 * SP 800-90C conditions). `inputBits` (n_in) defaults to max(1, ⌈h_in⌉) — the
 * smallest admissible input width, which minimizes Output_Entropy (it
 * increases with n_in), so omitting it is conservative; `narrowestWidth` (nw)
 * defaults to `outputBits`.
 *
 * History: before 0.2.0 this returned min(h_in, 0.999·n_out), which ignores the
 * collision term and overcredits by up to ~0.77 bits near h_in ≈ n_out
 * (e.g. 255.744 instead of 255.0 for 512 input bits carrying 256).
 */
export function vettedOutputEntropy(
  inputMinEntropy: number,
  outputBits: number,
  inputBits?: number,
  narrowestWidth?: number,
): number {
  if (
    typeof inputMinEntropy !== 'number' ||
    !Number.isFinite(inputMinEntropy) ||
    inputMinEntropy < 0
  ) {
    throw new NegentropyError(
      'invalid_config',
      `inputMinEntropy must be a finite number ≥ 0, got ${inputMinEntropy}`,
    )
  }
  const nIn = inputBits ?? Math.max(1, Math.ceil(inputMinEntropy))
  const nw = narrowestWidth ?? outputBits
  return Math.min(outputEntropy(nIn, outputBits, nw, inputMinEntropy), 0.999 * outputBits)
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

export interface DebiasAccountingOptions {
  /**
   * 'conservative' (default): outMinEntropy = min(8·outBytes, input claim) —
   * the claim never grows, whatever the input's dependence structure.
   * 'iid': full credit, 8 bits per packed output byte, even above the input
   * claim — valid only if the input bits really are iid (the pre-0.2.0
   * default).
   */
  basis?: 'conservative' | 'iid'
}

/**
 * Debias the input's BITS (von Neumann or Peres). Under the iid-bits
 * assumption the output bits are exactly uniform — there is no distributional
 * slack parameter, hence the assumption tag rather than an epsilon. By default
 * the credit is still capped at the input claim (a deterministic map cannot
 * add min-entropy, and a measured claim on correlated bits must not be inflated
 * by the iid assumption); opt into full iid credit with `{ basis: 'iid' }`.
 * Trailing bits that don't fill a byte are dropped (and not credited).
 */
export function debiasAccounted(
  input: AccountedBytes,
  method: 'von-neumann' | 'peres' = 'peres',
  opts: DebiasAccountingOptions = {},
): AccountedBytes {
  if (method !== 'peres' && method !== 'von-neumann') {
    throw new NegentropyError(
      'invalid_config',
      `debias method must be peres|von-neumann, got ${method}`,
    )
  }
  const basis = opts.basis ?? 'conservative'
  if (basis !== 'conservative' && basis !== 'iid') {
    throw new NegentropyError(
      'invalid_config',
      `debias basis must be conservative|iid, got ${basis}`,
    )
  }
  const bits = toBits(input.bytes)
  const debiased = method === 'peres' ? peres(bits) : vonNeumann(bits)
  const bytes = packBits(debiased)
  const outMinEntropy =
    basis === 'iid' ? bytes.length * 8 : Math.min(bytes.length * 8, input.claim.minEntropy)
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
      assumptions: [
        ...input.claim.assumptions,
        basis === 'iid'
          ? 'iid input bits (debiaser requirement; full output credit)'
          : 'iid input bits (debiaser requirement; credit capped at the input claim)',
      ],
    },
    trace: [...input.trace, step],
  }
}

/**
 * SP 800-90B vetted conditioning of the whole input into one 32-byte block.
 * Credit: `vettedOutputEntropy(h_in, 256, 8·inputBytes, 256)` — the
 * §3.1.5.1.2 Output_Entropy with the input width known, capped at 0.999·256.
 */
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
  const outMinEntropy = vettedOutputEntropy(
    input.claim.minEntropy,
    bytes.length * 8,
    Math.max(1, input.bytes.length * 8),
    bytes.length * 8,
  )
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
