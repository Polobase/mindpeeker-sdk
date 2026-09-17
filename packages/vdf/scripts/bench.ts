/**
 * VDF benchmark — measures sequential-squaring throughput and full
 * evaluate/prove/verify timings (Pietrzak and Wesolowski, with and without
 * checkpoints) on THIS machine. Not part of `bun test`. Run from packages/vdf:
 *
 *   bun scripts/bench.ts [T]
 */
import { calibrate } from '../src/calibrate.js'
import { evaluate } from '../src/evaluate.js'
import { RSA2048 } from '../src/moduli.js'
import { pietrzakProve } from '../src/prove.js'
import { proofToBytes, wesolowskiToBytes } from '../src/serialize.js'
import type { RsaModulus } from '../src/types.js'
import { pietrzakVerify } from '../src/verify.js'
import { wesolowskiProve, wesolowskiVerify } from '../src/wesolowski.js'

// 256-bit known-factorization test modulus (see test/helpers/test-modulus.ts).
const SMALL: RsaModulus = Object.freeze({
  n: 273352122251145161663493244090143900227n * 300502300844854219335184493716718087999n,
})

function fmt(x: number): string {
  return x >= 1000 ? Math.round(x).toLocaleString('en-US') : x.toPrecision(3)
}

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now()
  const value = await fn()
  return [value, performance.now() - start]
}

async function benchModulus(label: string, modulus: RsaModulus): Promise<void> {
  const cal = await calibrate(1000, { modulus, samples: 5 })
  console.log(`\n${label}`)
  console.log(
    `  squarings/sec : ${fmt(cal.squaringsPerSecond)} (median of ${cal.samples.map(fmt).join(', ')})`,
  )
  for (const [target, ms] of [
    ['1 s', 1000],
    ['60 s', 60_000],
  ] as const) {
    console.log(
      `  suggestT(${target.padEnd(4)}): ${fmt(cal.suggestT(ms))} local, ${fmt(cal.suggestT(ms, { adversarySpeedup: 1000 }))} vs 1000× adversary`,
    )
  }
}

async function benchPipeline(T: number): Promise<void> {
  const pulse = new TextEncoder().encode('bench-pulse')
  const k = Math.ceil(Math.sqrt(T))
  console.log(`\nRSA-2048 pipeline at T=${T} (checkpoints k=${k})`)
  const [ev, tEval] = await timed(() => evaluate(pulse, T, { checkpoints: k }))
  const { y, checkpoints } = ev
  const [pPlain, tPlain] = await timed(() => pietrzakProve(pulse, T, y))
  const [, tCk] = await timed(() => pietrzakProve(pulse, T, y, { checkpoints }))
  const [ok, tVerify] = await timed(() => pietrzakVerify(pulse, T, y, pPlain))
  const [wPlain, tWPlain] = await timed(() => wesolowskiProve(pulse, T, y))
  const [, tWCk] = await timed(() => wesolowskiProve(pulse, T, y, { checkpoints }))
  const [wOk, tWVerify] = await timed(() => wesolowskiVerify(pulse, T, y, wPlain))
  console.log(`  evaluate            : ${tEval.toFixed(1)} ms`)
  console.log(
    `  pietrzakProve       : ${tPlain.toFixed(1)} ms plain, ${tCk.toFixed(1)} ms with checkpoints`,
  )
  console.log(
    `  pietrzakVerify      : ${tVerify.toFixed(2)} ms → ${ok} (${pPlain.mus.length} rounds)`,
  )
  console.log(
    `  wesolowskiProve     : ${tWPlain.toFixed(1)} ms plain, ${tWCk.toFixed(1)} ms with checkpoints`,
  )
  console.log(`  wesolowskiVerify    : ${tWVerify.toFixed(2)} ms → ${wOk}`)
  console.log(
    `  proof bytes         : Pietrzak ${proofToBytes(pPlain).length}, Wesolowski ${wesolowskiToBytes(wPlain).length}`,
  )
}

const T = Number(process.argv[2] ?? 50_000)
console.log('@mindpeeker/vdf bench — sequential squaring throughput (single core)')
await benchModulus('RSA-2048 (production default)', RSA2048)
await benchModulus('256-bit test modulus (for scale)', SMALL)
await benchPipeline(T)
