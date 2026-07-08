import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface VdfFixture {
  generator: string
  modulus: { p: string; q: string; n: string }
  hashToGroup: { inputHex: string; x: string }[]
  evaluate: { inputHex: string; T: number; y: string }[]
  challenges: { x: string; y: string; mu: string; T: number; r: string }[]
  proofs: { inputHex: string; T: number; y: string; mus: string[] }[]
}

/** Load the Python-generated cross-check fixture (scripts/fixtures/generate.py). */
export function loadFixture(): VdfFixture {
  return JSON.parse(
    readFileSync(join(import.meta.dir, '..', 'fixtures', 'vdf.json'), 'utf8'),
  ) as VdfFixture
}

/** Hex string → bytes (fixture inputs are hex-encoded). */
export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16)
  return out
}
