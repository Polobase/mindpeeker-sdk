import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ProofCase {
  inputHex: string
  T: number
  y: string
  mus: string[]
}

export interface WesolowskiCase {
  inputHex: string
  T: number
  y: string
  ell: string
  pi: string
}

export interface VdfFixture {
  generator: string
  modulus: { p: string; q: string; n: string }
  fingerprint: string
  hashToGroup: { inputHex: string; x: string }[]
  evaluate: { inputHex: string; T: number; y: string }[]
  challenges: { x: string; y: string; mu: string; T: number; r: string }[]
  proofs: ProofCase[]
  wesolowski: WesolowskiCase[]
  wire: {
    pietrzak: { proofIndex: number; hex: string }
    wesolowski: { proofIndex: number; hex: string }
    seal: { pulseHex: string; T: number; y: string; mus: string[]; hex: string }
  }
  rsa2048: {
    fingerprint: string
    hashToGroup: { inputHex: string; x: string }
    proof: ProofCase
    wesolowski: WesolowskiCase
  }
  oddWidth: {
    p: string
    q: string
    n: string
    bits: number
    hashToGroup: { inputHex: string; x: string }
    proof: ProofCase
    proofHex: string
    wesolowski: WesolowskiCase
  }
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

/** Bytes → lowercase hex. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
