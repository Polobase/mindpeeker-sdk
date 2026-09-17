/**
 * Recipe 3: are two entropy sources independent? Transfer entropy both ways with the
 * χ² test and a circular-shift permutation test, plus a zero-lag check TE cannot do.
 * bun examples/src/03-transfer-entropy-check.ts [--source crypto] [--control offline] [--smoke]
 */
import {
  chiSquareTest,
  mutualInformation,
  permutationTest,
  symbolsFromBytes,
} from '@mindpeeker/flow'
import { chi2Sf } from '@mindpeeker/negentropy/numerics'
import { holm } from '@mindpeeker/psi'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'

const args = parseArgs()
const bytes = size(args, 1000, 100) // 8 bits per byte
const surrogates = size(args, 999, 99)
const read = async (name: string, label: string) =>
  symbolsFromBytes((await openSource(name, label).getBytes(bytes)).bytes, { alphabet: 2 })

const a = await read(args.source, 'A')
const b = await read(args.control, 'B')

// Two planted couplings so the tests have something to find:
// `leaky` copies A's previous bit about a quarter of the time; `twin` copies A's current bit.
const coin = await read('offline', 'coupling')
const leaky = b.map((bit, t) =>
  t > 0 && coin[t] === 1 && coin[(t + 1) % coin.length] === 1 ? (a[t - 1] as number) : bit,
)
const twin = Uint8Array.from(a)

const pairs = [
  ['A → B', a, b],
  ['B → A', b, a],
  ['A → leaky', a, leaky],
  ['A → twin', a, twin],
] as const
const results = pairs.map(([label, x, y]) => {
  const chi = chiSquareTest(x, y, { k: 1, l: 1 }) // G = 2N ln2 · TE ~ χ²(df) if adequate
  const perm = permutationTest(x, y, {
    k: 1,
    l: 1,
    surrogate: 'circularShift',
    surrogates,
    seed: 7,
  })
  return { label, te: perm.te, chi, perm }
})
const adjusted = holm(results.map((r) => r.perm.p)).adjusted // four tests were run

console.log('bits per stream    ', a.length)
for (const [i, r] of results.entries()) {
  console.log(
    r.label.padEnd(19),
    `TE ${fmt(r.te, 5)} bits`,
    `χ² p ${fmt(r.chi.p)} (${r.chi.adequate ? 'adequate' : 'inadequate'})`,
    `perm p ${fmt(r.perm.p)} (Holm ${fmt(adjusted[i] as number)}, ${r.perm.distinct} distinct)`,
  )
}

// Zero lag is invisible to TE (lags ≥ 1): test the same-sample dependence separately.
for (const [label, y] of [
  ['A ~ B', b],
  ['A ~ twin', twin],
] as const) {
  const mi = mutualInformation(a, y) // bits; G = 2N ln2 · MI ~ χ²(1) for binary streams
  console.log(
    label.padEnd(19),
    `MI ${fmt(mi, 5)} bits`,
    `G-test p ${fmt(chi2Sf(2 * a.length * Math.LN2 * mi, 1))}`,
  )
}
