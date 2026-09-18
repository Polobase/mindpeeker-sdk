// The wire between app/components/Vdf*.client.vue and app/workers/vdf.worker.ts.
//
// Everything in @mindpeeker/vdf is CPU-bound and synchronous between its
// cooperative yields, so every job runs in the worker. This module carries only
// plain data and type-only SDK imports — nothing of the SDK survives at runtime,
// so the client and the worker can both import it.

import type { ModulusIssueCode, VdfErrorCode } from '@mindpeeker/vdf'

/** Which group of unknown order a job works in. */
export type ModulusId = 'rsa2048' | 'demo256'

export interface ModulusMeta {
  readonly id: ModulusId
  readonly label: string
  readonly short: string
  readonly bits: number
  /** Element width in bytes — the wire format's `w`. */
  readonly width: number
  readonly note: string
}

export const MODULUS_META: Readonly<Record<ModulusId, ModulusMeta>> = {
  rsa2048: {
    id: 'rsa2048',
    label: 'RSA-2048 (the package default)',
    short: 'RSA-2048',
    bits: 2048,
    width: 256,
    note: 'The RSA Factoring Challenge modulus, unfactored since 1991. RSA Labs said the primes were destroyed — a trust statement, not a proof.',
  },
  demo256: {
    id: 'demo256',
    label: '256-bit demo modulus (factors published)',
    short: 'demo-256',
    bits: 256,
    width: 32,
    note: 'Two fixed 128-bit safe primes from the package test suite. Arithmetic is ~50× faster and the security is exactly zero: anyone holding p and q evaluates in O(log T).',
  },
}

export const MODULUS_IDS: readonly ModulusId[] = ['rsa2048', 'demo256']

/** A VdfError (or any thrown value) flattened for postMessage. */
export interface JobFailure {
  readonly name: string
  readonly code?: string
  readonly message: string
  readonly cause?: string
}

/** What a caught VdfError looked like, for the "it refused" panels. */
export interface CaughtError {
  readonly name: string
  readonly code: VdfErrorCode | string
  readonly message: string
}

// ---------------------------------------------------------------- pipeline

export interface PipelinePayload {
  readonly input: Uint8Array
  readonly T: number
  readonly modulusId: ModulusId
  /** Stored powers for the provers; `0` evaluates without checkpoints. */
  readonly checkpoints: number
  /** Also run both provers without checkpoints (roughly doubles the work). */
  readonly plain: boolean
}

export interface ProofTimings {
  /** Prove time without checkpoints, or null when that arm was skipped. */
  readonly proveMs: number | null
  readonly proveCkMs: number
  readonly verifyMs: number
  readonly ok: boolean
  readonly bytes: number
  /** Both provers returned byte-identical proofs (null when the plain arm was skipped). */
  readonly identical: boolean | null
}

export interface PipelineResult {
  readonly T: number
  readonly modulusId: ModulusId
  readonly modulusBits: number
  readonly width: number
  readonly checkpoints: number
  readonly interval: number
  readonly rounds: number
  readonly xHex: string
  readonly yHex: string
  readonly evalMs: number
  readonly costPlain: number
  readonly costCk: number
  readonly pietrzak: ProofTimings
  readonly wesolowski: ProofTimings & { readonly ellHex: string }
  /** Squarings per second implied by the evaluation phase alone. */
  readonly evalSquaringsPerSecond: number
  readonly finishedAt: number
}

// ---------------------------------------------------------------- forgery

export type RepairKind = 'odd-round' | 'flipped-midpoint' | 'none'

export interface ForgeryRow {
  readonly T: number
  readonly powerOfTwo: boolean
  readonly rounds: number
  /** First round whose $T_i$ is odd (1-based), or null when every $T_i$ is even. */
  readonly oddRound: number | null
  readonly repairedBy: RepairKind
  readonly repairedAtRound: number | null
  readonly honestYHex: string
  readonly negatedYHex: string
  /** A range-only (0.1.0-style) verifier written for this page accepts the forgery. */
  readonly rawAccepts: boolean
  /** The shipped verifier on the negated claim — must be false. */
  readonly sdkVerifyNegated: boolean
  /** The shipped verifier on the honest claim — must be true. */
  readonly sdkVerifyHonest: boolean
  /** What `pietrzakProve` threw when handed the negated claim. */
  readonly proveNegated: CaughtError | null
  /** `wesolowskiVerify` with π replaced by n − π — must be false. */
  readonly wesolowskiNegatedPi: boolean
  /** |π'^ℓ · x^r| = y — a sign-blind verifier would have accepted n − π. */
  readonly signBlindProduct: boolean
  readonly ms: number
}

export interface ForgeryPayload {
  readonly input: Uint8Array
  readonly Ts: readonly number[]
  readonly modulusId: ModulusId
}

export interface ForgeryResult {
  readonly modulusId: ModulusId
  readonly rows: readonly ForgeryRow[]
  readonly totalMs: number
}

// ---------------------------------------------------------------- modulus

export interface ModulusCaseRow {
  readonly id: string
  readonly label: string
  readonly expr: string
  readonly note: string
  readonly bits: number
  readonly ok: boolean
  readonly reasons: readonly { readonly code: ModulusIssueCode; readonly message: string }[]
  readonly ms: number
}

export interface ModulusPayload {
  readonly minBits: number
}

export interface ModulusResult {
  readonly minBits: number
  readonly hardFloor: number
  readonly recommended: number
  readonly rows: readonly ModulusCaseRow[]
  readonly totalMs: number
}

// ---------------------------------------------------------------- seal

export interface TamperCase {
  readonly label: string
  readonly offset: number
  readonly before: number
  readonly after: number
  /** The verifier's answer, or null when the parser threw instead. */
  readonly verified: boolean | null
  readonly error: CaughtError | null
}

export interface SealPayload {
  readonly pulse: Uint8Array
  readonly T: number
  readonly modulusId: ModulusId
  /** Byte offset inside the element region to flip. */
  readonly tamperOffset: number
}

export interface SealResult {
  readonly T: number
  readonly modulusId: ModulusId
  readonly rounds: number
  readonly yHex: string
  readonly sealHex: string
  readonly sealLength: number
  readonly expectedLength: number
  readonly headerLength: number
  readonly width: number
  readonly pulseDigestHex: string
  readonly pulseHex: string
  readonly verifyBytes: boolean
  readonly verifyObject: boolean
  /** Same seal bytes, a pulse that differs in one byte. */
  readonly wrongPulse: boolean
  readonly tampers: readonly TamperCase[]
  readonly sealMs: number
  readonly verifyMs: number
  readonly finishedAt: number
}

// ---------------------------------------------------------------- calibrate

export interface SuggestRow {
  readonly wallMs: number
  readonly speedup: number
  readonly T: number
  /** Wall time evaluating that T costs on THIS machine. */
  readonly localMs: number
}

export interface CalibratePayload {
  readonly sampleMs: number
  readonly samples: number
  readonly modulusId: ModulusId
  readonly wallMs: readonly number[]
  readonly speedups: readonly number[]
}

export interface CalibrateResult {
  readonly modulusId: ModulusId
  readonly sampleMs: number
  readonly squaringsPerSecond: number
  readonly samples: readonly number[]
  readonly spread: number
  readonly rows: readonly SuggestRow[]
  readonly maxT: number
  readonly elapsedMs: number
  readonly finishedAt: number
}

// ---------------------------------------------------------------- protocol

export interface VdfJobs {
  pipeline: { payload: PipelinePayload; result: PipelineResult }
  forgery: { payload: ForgeryPayload; result: ForgeryResult }
  modulus: { payload: ModulusPayload; result: ModulusResult }
  seal: { payload: SealPayload; result: SealResult }
  calibrate: { payload: CalibratePayload; result: CalibrateResult }
}

export type VdfJobName = keyof VdfJobs

export interface VdfJobRequest {
  readonly id: number
  readonly job: VdfJobName
  readonly payload: VdfJobs[VdfJobName]['payload']
}

export interface VdfCancelRequest {
  readonly id: number
  readonly cancel: true
}

export interface VdfProgress {
  readonly id: number
  readonly kind: 'progress'
  readonly phase: string
  readonly fraction: number | null
}

export type VdfJobResponse =
  | VdfProgress
  | { readonly id: number; readonly kind: 'ok'; readonly result: unknown }
  | { readonly id: number; readonly kind: 'error'; readonly error: JobFailure }

/** Big-endian lowercase hex of a group element, zero-padded to the modulus width. */
export function elementHex(value: bigint, width: number): string {
  return value.toString(16).padStart(width * 2, '0')
}

/** `24 93 30 fe … 7c 01` — the head and tail of a long hex string. */
export function ellipsizeHex(hex: string, head = 16, tail = 8): string {
  if (hex.length <= head + tail + 3) return hex
  return `${hex.slice(0, head)}…${hex.slice(-tail)}`
}

/** T values the pipeline slider offers: 2^10 … 2^18. */
export const T_MIN_EXPONENT = 10
export const T_MAX_EXPONENT = 18
export const T_EXPONENTS: readonly number[] = Array.from(
  { length: T_MAX_EXPONENT - T_MIN_EXPONENT + 1 },
  (_, i) => T_MIN_EXPONENT + i,
)

/** Superscript rendering for 2^k without assembling icon names or unicode at runtime. */
const SUPERSCRIPTS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']

export function superscript(value: number): string {
  return String(value)
    .split('')
    .map((d) => SUPERSCRIPTS[Number(d)] ?? d)
    .join('')
}
