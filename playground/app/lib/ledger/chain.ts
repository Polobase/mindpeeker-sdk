// Hash-chain material for the ledger page: building a ledger chain, the ways a
// file can be altered, and a psi schema-v2 recording written in the browser.
//
// CLIENT-ONLY — imports @mindpeeker/ledger and @mindpeeker/psi.

import { appendEntry, canonicalize, type ChainHead, sha256Hex, startChain } from '@mindpeeker/ledger'
import { recordSession } from '@mindpeeker/psi'
import { drbgSource } from '~/lib/entropy'

/** One record as the demo edits it, before it becomes a canonical line. */
export interface DemoRecord {
  readonly run: number
  readonly arm: 'experimental' | 'control'
  readonly sum: number
}

export interface BuiltChain {
  readonly lines: readonly string[]
  readonly records: readonly DemoRecord[]
  readonly genesis: string
  /** SHA-256 of the last line — the value you publish so truncation is detectable. */
  readonly head: string
  readonly chain: ChainHead
}

/** Append every record to a fresh chain and keep the lines, exactly as a log writer would. */
export async function buildChain(
  records: readonly DemoRecord[],
  genesis: string,
): Promise<BuiltChain> {
  let chain = startChain(genesis)
  const lines: string[] = []
  for (const record of records) {
    const appended = await appendEntry(chain, record)
    lines.push(appended.line)
    chain = appended.chain
  }
  return { lines, records, genesis, head: chain.head, chain }
}

export type TamperKind =
  | 'none'
  | 'edit-record'
  | 'edit-spacing'
  | 'delete'
  | 'swap'
  | 'truncate'
  | 'rewrite'

export interface TamperOption {
  readonly value: TamperKind
  readonly label: string
  /** What verifyChain should report — the exact expectation to compare the run against. */
  readonly expect: string
}

export const TAMPERS: readonly TamperOption[] = [
  { value: 'none', label: 'none — the file as written', expect: 'ok · head matches' },
  {
    value: 'edit-record',
    label: 'edit one sum (+1), keep the line canonical',
    expect: "bad_prev at the NEXT line — the edit itself is legal JSON, its hash is not",
  },
  {
    value: 'edit-spacing',
    label: 'add one space inside that line',
    expect: 'not_canonical at that line — canonical form is the only accepted spelling',
  },
  {
    value: 'delete',
    label: 'delete that line',
    expect: 'bad_index at that position — i no longer counts 0, 1, 2, …',
  },
  {
    value: 'swap',
    label: 'swap it with the next line',
    expect: 'bad_index / bad_prev at that position',
  },
  {
    value: 'truncate',
    label: 'drop the last line',
    expect: 'ok WITHOUT a published head · head_mismatch with one',
  },
  {
    value: 'rewrite',
    label: 'rewrite the whole file from edited records',
    expect: 'ok WITHOUT a published head · head_mismatch with one',
  },
]

/**
 * Alter a chain file the way an editor, a script or a dishonest operator
 * would. Returns the new lines; the chain itself is never mutated.
 */
export async function applyTamper(
  built: BuiltChain,
  kind: TamperKind,
  index: number,
): Promise<readonly string[]> {
  const lines = [...built.lines]
  if (kind === 'none' || lines.length === 0) return lines
  const at = Math.min(Math.max(0, index), lines.length - 1)
  switch (kind) {
    case 'edit-record': {
      const entry = JSON.parse(lines[at] as string) as { i: number; prev: string; record: DemoRecord }
      const record = { ...entry.record, sum: entry.record.sum + 1 }
      lines[at] = canonicalize({ i: entry.i, prev: entry.prev, record })
      return lines
    }
    case 'edit-spacing':
      lines[at] = (lines[at] as string).replace('{"i"', '{ "i"')
      return lines
    case 'delete':
      lines.splice(at, 1)
      return lines
    case 'swap': {
      const next = Math.min(at + 1, lines.length - 1)
      const a = lines[at] as string
      lines[at] = lines[next] as string
      lines[next] = a
      return lines
    }
    case 'truncate':
      lines.pop()
      return lines
    case 'rewrite': {
      const records = built.records.map((record, i) =>
        i === at ? { ...record, sum: record.sum + 1 } : record,
      )
      return (await buildChain(records, built.genesis)).lines
    }
  }
}

export interface PsiRecording {
  readonly lines: readonly string[]
  readonly genesis: string
  /** SHA-256 of the last line, recomputed here so the page never trusts its own writer. */
  readonly head: string
}

export interface PsiRecordOptions {
  readonly sources: number
  readonly rounds: number
  readonly bitsPerTrial: number
  readonly seedLabel: string
  readonly bindRegistration: boolean
  readonly signal?: AbortSignal
  readonly onProgress?: (fraction: number) => void
}

const T0 = Date.UTC(2026, 8, 17, 12, 0, 0)

/**
 * Write a psi schema-v2 JSONL recording in the browser from independent DRBG
 * sources, so the ledger's `verifyChain(lines, { format: 'psi' })` has a real
 * foreign file to check rather than one of its own.
 */
export async function recordPsi(opts: PsiRecordOptions): Promise<PsiRecording> {
  const genesis = opts.bindRegistration
    ? await sha256Hex(
        canonicalize({
          plan: 'ledger playground psi recording',
          rounds: opts.rounds,
          sources: opts.sources,
        }),
      )
    : '0'.repeat(64)
  const sources = Array.from({ length: opts.sources }, (_, i) =>
    drbgSource(`${opts.seedLabel} / ledger-log-${i + 1}`),
  )
  const total = opts.sources * opts.rounds + 1
  const lines: string[] = []
  let round = 0
  for await (const line of recordSession(sources, {
    bitsPerTrial: opts.bitsPerTrial,
    chunkBytes: opts.bitsPerTrial / 8,
    chain: opts.bindRegistration ? { registration: genesis } : true,
    // A fixed clock: every reader of this page gets the same file and the same head.
    now: () => T0 + Math.floor(round++ / opts.sources) * 1000,
    ...(opts.signal ? { signal: opts.signal } : {}),
  })) {
    lines.push(line)
    opts.onProgress?.(lines.length / total)
    if (lines.length >= total) break
  }
  return { lines, genesis, head: await sha256Hex(lines[lines.length - 1] as string) }
}

/** Edit one trial sum in a psi recording, the way recipe 2 does. */
export function tamperPsi(lines: readonly string[], index: number): string[] {
  const copy = [...lines]
  const at = Math.min(Math.max(1, index), copy.length - 1)
  const trial = JSON.parse(copy[at] as string) as { sum: number }
  trial.sum = trial.sum === 0 ? 1 : trial.sum - 1
  copy[at] = JSON.stringify(trial)
  return copy
}
