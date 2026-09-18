// The five jobs app/workers/vdf.worker.ts runs. Every one of them is pure
// @mindpeeker/vdf plus timing; nothing here touches the DOM.
//
// WORKER-ONLY: imports @mindpeeker/vdf.

import {
  calibrate,
  checkModulus,
  evaluate,
  hashToGroup,
  hashToPrime,
  MAX_T,
  MIN_MODULUS_BITS,
  pietrzakProve,
  pietrzakProveCost,
  pietrzakRounds,
  pietrzakVerify,
  proofToBytes,
  RECOMMENDED_MODULUS_BITS,
  sealBeacon,
  sealFromBytes,
  sealToBytes,
  VdfError,
  verifySeal,
  verifySealBytes,
  wesolowskiProve,
  wesolowskiToBytes,
  wesolowskiVerify,
} from '@mindpeeker/vdf'
import { forgeNegatedProof, rangeOnlyVerify, signBlindWesolowskiCheck } from './forgery'
import type {
  CalibratePayload,
  CalibrateResult,
  CaughtError,
  ForgeryPayload,
  ForgeryResult,
  ForgeryRow,
  ModulusCaseRow,
  ModulusPayload,
  ModulusResult,
  PipelinePayload,
  PipelineResult,
  SealPayload,
  SealResult,
  SuggestRow,
  TamperCase,
} from './jobs'
import { elementHex } from './jobs'
import { MODULUS_CASES, modulusBits, modulusWidth, resolveModulus } from './moduli'

export type Report = (phase: string, fraction: number | null) => void

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

function caught(error: unknown): CaughtError {
  if (error instanceof VdfError) {
    return { name: error.name, code: error.code, message: error.message }
  }
  if (error instanceof Error) return { name: error.name, code: 'unknown', message: error.message }
  return { name: 'Error', code: 'unknown', message: String(error) }
}

/** A progress meter over phases of known relative cost. */
function phases(report: Report, weights: readonly (readonly [string, number])[]) {
  const total = weights.reduce((sum, [, w]) => sum + w, 0) || 1
  let done = 0
  let index = 0
  return {
    enter(): { label: string; onProgress: (d: number, t: number) => void } {
      const entry = weights[index] ?? (['working', 0] as const)
      const [label, weight] = entry
      const base = done
      report(label, base / total)
      return {
        label,
        onProgress: (d, t) => {
          if (t > 0) report(label, (base + (weight * d) / t) / total)
        },
      }
    },
    leave(): void {
      done += weights[index]?.[1] ?? 0
      index++
      report(weights[index]?.[0] ?? 'done', done / total)
    },
  }
}

// ---------------------------------------------------------------- pipeline

export async function runPipeline(
  payload: PipelinePayload,
  signal: AbortSignal,
  report: Report,
): Promise<PipelineResult> {
  const { T, plain } = payload
  const modulus = resolveModulus(payload.modulusId)
  const bits = modulusBits(modulus.n)
  const width = modulusWidth(modulus.n)
  const checkpoints = Math.min(T, Math.max(1, payload.checkpoints || Math.ceil(Math.sqrt(T))))
  const interval = Math.ceil(T / checkpoints)
  const costPlain = pietrzakProveCost(T)
  const costCk = pietrzakProveCost(T, interval)
  const input = payload.input

  const meter = phases(report, [
    ['evaluate — T sequential squarings', T],
    ['pietrzakProve — no checkpoints', plain ? costPlain : 0],
    ['pietrzakProve — √T checkpoints', costCk],
    ['wesolowskiProve — no checkpoints', plain ? T * 1.125 : 0],
    ['wesolowskiProve — √T checkpoints', T * 0.2],
    ['verify both proofs', Math.max(1, T * 0.01)],
  ])

  let step = meter.enter()
  const evalStart = performance.now()
  const ev = await evaluate(input, T, {
    modulus,
    signal,
    checkpoints,
    onProgress: step.onProgress,
  })
  const evalMs = performance.now() - evalStart
  meter.leave()

  step = meter.enter()
  let pProveMs: number | null = null
  let pPlainProof: Awaited<ReturnType<typeof pietrzakProve>> | undefined
  if (plain) {
    const t0 = performance.now()
    pPlainProof = await pietrzakProve(input, T, ev.y, { modulus, signal, onProgress: step.onProgress })
    pProveMs = performance.now() - t0
  }
  meter.leave()

  step = meter.enter()
  const pCkStart = performance.now()
  const pProof = await pietrzakProve(input, T, ev.y, {
    modulus,
    signal,
    checkpoints: ev.checkpoints,
    onProgress: step.onProgress,
  })
  const pProveCkMs = performance.now() - pCkStart
  meter.leave()

  step = meter.enter()
  let wProveMs: number | null = null
  let wPlainProof: Awaited<ReturnType<typeof wesolowskiProve>> | undefined
  if (plain) {
    const t0 = performance.now()
    wPlainProof = await wesolowskiProve(input, T, ev.y, {
      modulus,
      signal,
      onProgress: step.onProgress,
    })
    wProveMs = performance.now() - t0
  }
  meter.leave()

  step = meter.enter()
  const wCkStart = performance.now()
  const wProof = await wesolowskiProve(input, T, ev.y, {
    modulus,
    signal,
    checkpoints: ev.checkpoints,
    onProgress: step.onProgress,
  })
  const wProveCkMs = performance.now() - wCkStart
  meter.leave()

  meter.enter()
  const pVerifyStart = performance.now()
  const pOk = await pietrzakVerify(input, T, ev.y, pProof, { modulus })
  const pVerifyMs = performance.now() - pVerifyStart
  const wVerifyStart = performance.now()
  const wOk = await wesolowskiVerify(input, T, ev.y, wProof, { modulus })
  const wVerifyMs = performance.now() - wVerifyStart
  meter.leave()

  const x = await hashToGroup(input, modulus)
  const ell = await hashToPrime(x, ev.y, T, modulus)

  return {
    T,
    modulusId: payload.modulusId,
    modulusBits: bits,
    width,
    checkpoints,
    interval,
    rounds: pietrzakRounds(T),
    xHex: elementHex(ev.x, width),
    yHex: elementHex(ev.y, width),
    evalMs,
    costPlain,
    costCk,
    evalSquaringsPerSecond: evalMs > 0 ? (T / evalMs) * 1000 : 0,
    pietrzak: {
      proveMs: pProveMs,
      proveCkMs: pProveCkMs,
      verifyMs: pVerifyMs,
      ok: pOk,
      bytes: proofToBytes(pProof, { modulus }).length,
      identical: pPlainProof
        ? pPlainProof.mus.length === pProof.mus.length &&
          pPlainProof.mus.every((mu, i) => mu === pProof.mus[i])
        : null,
    },
    wesolowski: {
      proveMs: wProveMs,
      proveCkMs: wProveCkMs,
      verifyMs: wVerifyMs,
      ok: wOk,
      bytes: wesolowskiToBytes(wProof, { modulus }).length,
      identical: wPlainProof ? wPlainProof.pi === wProof.pi : null,
      ellHex: ell.toString(16),
    },
    finishedAt: Date.now(),
  }
}

// ---------------------------------------------------------------- forgery

export async function runForgery(
  payload: ForgeryPayload,
  signal: AbortSignal,
  report: Report,
): Promise<ForgeryResult> {
  const modulus = resolveModulus(payload.modulusId)
  const width = modulusWidth(modulus.n)
  const { input } = payload
  const rows: ForgeryRow[] = []
  const started = performance.now()

  for (const [index, T] of payload.Ts.entries()) {
    if (signal.aborted) throw new VdfError('aborted', 'the run was cancelled')
    report(`T = ${T} — evaluate, forge, verify`, index / payload.Ts.length)
    const t0 = performance.now()

    const ev = await evaluate(input, T, { modulus, signal })
    const honestProof = await pietrzakProve(input, T, ev.y, { modulus, signal })
    const sdkVerifyHonest = await pietrzakVerify(input, T, ev.y, honestProof, { modulus })

    const forged = await forgeNegatedProof(input, T, ev.y, modulus)
    const rawAccepts = await rangeOnlyVerify(input, T, forged.claim, forged.mus, modulus)
    const sdkVerifyNegated = await pietrzakVerify(
      input,
      T,
      forged.claim,
      { T, y: forged.claim, mus: forged.mus },
      { modulus },
    )

    let proveNegated: CaughtError | null = null
    try {
      await pietrzakProve(input, T, forged.claim, { modulus, signal })
    } catch (error) {
      proveNegated = caught(error)
    }

    const wProof = await wesolowskiProve(input, T, ev.y, { modulus, signal })
    const wesolowskiNegatedPi = await wesolowskiVerify(
      input,
      T,
      ev.y,
      { T, y: ev.y, pi: modulus.n - wProof.pi },
      { modulus },
    )
    const x = await hashToGroup(input, modulus)
    const ell = await hashToPrime(x, ev.y, T, modulus)
    const signBlindProduct = signBlindWesolowskiCheck(x, ev.y, wProof.pi, ell, T, modulus.n)

    rows.push({
      T,
      powerOfTwo: (T & (T - 1)) === 0,
      rounds: forged.rounds,
      oddRound: forged.oddRound,
      repairedBy: forged.repairedBy,
      repairedAtRound: forged.repairedAtRound,
      honestYHex: elementHex(ev.y, width),
      negatedYHex: elementHex(forged.claim, width),
      rawAccepts,
      sdkVerifyNegated,
      sdkVerifyHonest,
      proveNegated,
      wesolowskiNegatedPi,
      signBlindProduct,
      ms: performance.now() - t0,
    })
    report(`T = ${T} — done`, (index + 1) / payload.Ts.length)
  }

  return { modulusId: payload.modulusId, rows, totalMs: performance.now() - started }
}

// ---------------------------------------------------------------- modulus

export function runModulusChecks(payload: ModulusPayload, report: Report): ModulusResult {
  const minBits = Math.max(MIN_MODULUS_BITS, Math.trunc(payload.minBits) || MIN_MODULUS_BITS)
  const rows: ModulusCaseRow[] = []
  const started = performance.now()
  for (const [index, entry] of MODULUS_CASES.entries()) {
    report(`checkModulus — ${entry.label}`, index / MODULUS_CASES.length)
    const t0 = performance.now()
    const check = checkModulus({ n: entry.n }, { minBits })
    rows.push({
      id: entry.id,
      label: entry.label,
      expr: entry.expr,
      note: entry.note,
      bits: check.bits,
      ok: check.ok,
      reasons: check.reasons.map((r) => ({ code: r.code, message: r.message })),
      ms: performance.now() - t0,
    })
  }
  return {
    minBits,
    hardFloor: MIN_MODULUS_BITS,
    recommended: RECOMMENDED_MODULUS_BITS,
    rows,
    totalMs: performance.now() - started,
  }
}

// ---------------------------------------------------------------- seal

/** Flip one byte of a copy and report what the parser/verifier then said. */
async function tamper(
  label: string,
  pulse: Uint8Array,
  bytes: Uint8Array,
  offset: number,
  mask: number,
  modulus: { n: bigint },
): Promise<TamperCase> {
  const copy = bytes.slice()
  const before = copy[offset] ?? 0
  const after = before ^ mask
  copy[offset] = after
  try {
    return {
      label,
      offset,
      before,
      after,
      verified: await verifySealBytes(pulse, copy, { modulus }),
      error: null,
    }
  } catch (error) {
    return { label, offset, before, after, verified: null, error: caught(error) }
  }
}

export async function runSeal(
  payload: SealPayload,
  signal: AbortSignal,
  report: Report,
): Promise<SealResult> {
  const modulus = resolveModulus(payload.modulusId)
  const width = modulusWidth(modulus.n)
  const { T, pulse } = payload
  const rounds = pietrzakRounds(T)
  const headerLength = 46
  const expectedLength = headerLength + width * (1 + rounds)

  const sealStart = performance.now()
  const seal = await sealBeacon(pulse, T, {
    modulus,
    signal,
    onProgress: (done, total) => {
      if (total > 0) report('sealBeacon — evaluate, then prove', done / total)
    },
  })
  const sealMs = performance.now() - sealStart

  report('verifySealBytes and the tamper cases', null)
  const bytes = sealToBytes(seal, pulse, { modulus })
  const decoded = sealFromBytes(bytes, { modulus })

  const verifyStart = performance.now()
  const verifyBytes = await verifySealBytes(pulse, bytes, { modulus })
  const verifyMs = performance.now() - verifyStart
  const verifyObject = await verifySeal(pulse, seal, { modulus })

  const otherPulse = pulse.slice()
  otherPulse[0] = (otherPulse[0] ?? 0) ^ 0x01
  const wrongPulse = await verifySealBytes(otherPulse, bytes, { modulus })

  const elementOffset = Math.min(
    bytes.length - 1,
    Math.max(headerLength, Math.trunc(payload.tamperOffset) || headerLength),
  )

  const tampers: TamperCase[] = [
    await tamper('one bit of y', pulse, bytes, elementOffset, 0x01, modulus),
    await tamper('the version byte', pulse, bytes, 0, 0x01, modulus),
    await tamper('one byte of the modulus fingerprint', pulse, bytes, 2, 0xff, modulus),
  ]
  try {
    const short = bytes.slice(0, bytes.length - 1)
    tampers.push({
      label: 'the last byte removed',
      offset: bytes.length - 1,
      before: bytes[bytes.length - 1] ?? 0,
      after: -1,
      verified: await verifySealBytes(pulse, short, { modulus }),
      error: null,
    })
  } catch (error) {
    tampers.push({
      label: 'the last byte removed',
      offset: bytes.length - 1,
      before: bytes[bytes.length - 1] ?? 0,
      after: -1,
      verified: null,
      error: caught(error),
    })
  }

  return {
    T,
    modulusId: payload.modulusId,
    rounds,
    yHex: elementHex(seal.y, width),
    sealHex: toHex(bytes),
    sealLength: bytes.length,
    expectedLength,
    headerLength,
    width,
    pulseDigestHex: toHex(decoded.pulseDigest),
    pulseHex: toHex(pulse),
    verifyBytes,
    verifyObject,
    wrongPulse,
    tampers,
    sealMs,
    verifyMs,
    finishedAt: Date.now(),
  }
}

// ---------------------------------------------------------------- calibrate

export async function runCalibrate(
  payload: CalibratePayload,
  signal: AbortSignal,
  report: Report,
): Promise<CalibrateResult> {
  const modulus = resolveModulus(payload.modulusId)
  report(`calibrate(${payload.sampleMs}) — ${payload.samples} timing windows`, null)
  const started = performance.now()
  const result = await calibrate(payload.sampleMs, {
    modulus,
    samples: payload.samples,
    signal,
  })
  const elapsedMs = performance.now() - started
  const rows: SuggestRow[] = []
  for (const wallMs of payload.wallMs) {
    for (const speedup of payload.speedups) {
      const T = result.suggestT(wallMs, { adversarySpeedup: speedup })
      rows.push({
        wallMs,
        speedup,
        T,
        localMs: (T / result.squaringsPerSecond) * 1000,
      })
    }
  }
  const samples = [...result.samples]
  const lo = Math.min(...samples)
  const hi = Math.max(...samples)
  return {
    modulusId: payload.modulusId,
    sampleMs: payload.sampleMs,
    squaringsPerSecond: result.squaringsPerSecond,
    samples,
    spread: result.squaringsPerSecond > 0 ? (hi - lo) / result.squaringsPerSecond : 0,
    rows,
    maxT: MAX_T,
    elapsedMs,
    finishedAt: Date.now(),
  }
}
