/**
 * Regenerate test/fixtures/psi-v2-recording.jsonl: a schema-v2, hash-chained
 * session recording written by @mindpeeker/psi itself (resolved from source
 * through the workspace tsconfig paths — psi is not a ledger dependency).
 * Two deterministic xorshift32 sources, 16 bits per trial, 8 rounds, a fake
 * clock, tags, and a registration binding.
 *
 * Usage: bun packages/ledger/scripts/fixtures/psi-recording.ts
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { recordSession } from '@mindpeeker/psi'

export const REGISTRATION = 'a1'.repeat(32)

function source(name: string, seed: number) {
  return {
    name,
    async *stream() {
      let state = seed
      for (let round = 0; round < 8; round++) {
        const chunk = new Uint8Array(2)
        for (let i = 0; i < chunk.length; i++) {
          state ^= state << 13
          state ^= state >>> 17
          state ^= state << 5
          state >>>= 0
          chunk[i] = state & 0xff
        }
        yield chunk
      }
    },
  }
}

export async function psiRecording(): Promise<string[]> {
  let t = 1_767_225_600_000
  const lines: string[] = []
  for await (const line of recordSession(
    [source('alpha', 0x9e3779b9), source('beta', 0x7f4a7c15)],
    {
      bitsPerTrial: 16,
      now: () => (t += 1000),
      chain: { registration: REGISTRATION },
      tags: (round) => ({ arm: round % 2 === 0 ? 'experimental' : 'control', run: round }),
    },
  )) {
    lines.push(line)
  }
  return lines
}

if (import.meta.main) {
  const lines = await psiRecording()
  const out = join(import.meta.dir, '..', '..', 'test', 'fixtures', 'psi-v2-recording.jsonl')
  writeFileSync(out, `${lines.join('\n')}\n`)
  console.log(`wrote ${lines.length} lines to ${out}`)
}
