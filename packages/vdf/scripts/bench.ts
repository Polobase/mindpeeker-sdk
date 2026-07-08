/**
 * VDF benchmark — measures sequential-squaring throughput and full
 * evaluate/prove/verify timings on THIS machine. Not part of `bun test`.
 * Run from packages/vdf:
 *
 *   bun scripts/bench.ts
 */
import { calibrate } from '../src/calibrate.js'
import { evaluate } from '../src/evaluate.js'
import { RSA2048 } from '../src/moduli.js'
import { pietrzakProve } from '../src/prove.js'
import { proofToBytes } from '../src/serialize.js'
import type { RsaModulus } from '../src/types.js'
import { pietrzakVerify } from '../src/verify.js'

// 256-bit known-factorization test modulus (see test/helpers/test-modulus.ts).
const SMALL: RsaModulus = Object.freeze({
  n: 273352122251145161663493244090143900227n * 300502300844854219335184493716718087999n,
})

function fmt(x: number): string {
  return x >= 1000 ? Math.round(x).toLocaleString('en-US') : x.toPrecision(3)
}

async function benchModulus(label: string, modulus: RsaModulus): Promise<void> {
  const cal = await calibrate(500, { modulus })
  console.log(`\n${label}`)
  console.log(`  squarings/sec : ${fmt(cal.squaringsPerSecond)}`)
  for (const [target, ms] of [
    ['1 s', 1000],
    ['10 s', 10_000],
    ['60 s', 60_000],
  ] as const) {
    console.log(`  suggestT(${target.padEnd(4)}): ${fmt(cal.suggestT(ms))}`)
  }
}

async function benchPipeline(T: number): Promise<void> {
  const pulse = new TextEncoder().encode('bench-pulse')
  console.log(`\nRSA-2048 pipeline at T=${T}`)
  let t0 = performance.now()
  const { y } = await evaluate(pulse, T)
  const tEval = performance.now() - t0
  t0 = performance.now()
  const proof = await pietrzakProve(pulse, T, y)
  const tProve = performance.now() - t0
  t0 = performance.now()
  const ok = await pietrzakVerify(pulse, T, y, proof)
  const tVerify = performance.now() - t0
  const bytes = proofToBytes(proof)
  console.log(`  evaluate : ${tEval.toFixed(1)} ms`)
  console.log(`  prove    : ${tProve.toFixed(1)} ms (${proof.mus.length} rounds)`)
  console.log(`  verify   : ${tVerify.toFixed(2)} ms → ${ok}`)
  console.log(`  proof    : ${bytes.length} bytes`)
}

console.log('@mindpeeker/vdf bench — sequential squaring throughput (single core)')
await benchModulus('RSA-2048 (production default)', RSA2048)
await benchModulus('256-bit test modulus (for scale)', SMALL)
await benchPipeline(50_000)
