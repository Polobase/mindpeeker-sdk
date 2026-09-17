/**
 * Recipe 8: scoring a ganzfeld-style study and Zener closed-deck runs exactly, and pricing
 * the best of several looks. The data are simulated under the null: the "receiver" draws
 * from a source independent of the target draw.
 * bun examples/src/08-judging-forced-choice.ts [--source crypto] [--control offline] [--smoke]
 */
import {
  closedDeckTest,
  deflatedCriticalValue,
  directHits,
  expectedMaxOfLooks,
  forcedChoiceBayesFactor,
  forcedChoiceTest,
  maxOfLooksPValue,
} from '@mindpeeker/judging'
import { byteReader, drawWithoutReplacement, uniformInt } from '@mindpeeker/oracle'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'

const args = parseArgs()
const targets = byteReader(openSource(args.source, 'targets'))
const receiver = byteReader(openSource(args.control, 'receiver'))

// 1. Ganzfeld: one target among four clips per session, scored as a direct hit.
const batches = 5
const perBatch = size(args, 40, 8)
const batchHits: number[] = []
for (let b = 0; b < batches; b++) {
  let hits = 0
  for (let s = 0; s < perBatch; s++) {
    if ((await uniformInt(targets, 4)) === (await uniformInt(receiver, 4))) hits++
  }
  batchHits.push(hits)
}
const hits = batchHits.reduce((a, b) => a + b, 0)
const sessions = batches * perBatch
const g = directHits(hits, sessions, 4)
const bf = forcedChoiceBayesFactor(hits, sessions, { p0: 1 / 4, alternative: 'greater' })
console.log('ganzfeld           ', `${hits}/${sessions} hits, chance 1/4`)
console.log('  critical ratio   ', fmt(g.criticalRatio), `exact P(X ≥ ${hits}) ${fmt(g.pOneSided)}`)
console.log(
  '  hit rate 95% CI  ',
  `${fmt(g.confidenceInterval.lower)} … ${fmt(g.confidenceInterval.upper)}`,
)
console.log('  BF10 (p0 = 1/4)  ', fmt(bf.bf10), `(BF01 ${fmt(bf.bf01)})`)

// 2. Post-hoc selection: report only the best of the five batches.
const zs = batchHits.map((h) => directHits(h, perBatch, 4).criticalRatio)
const best = Math.max(...zs)
console.log(
  'best batch z       ',
  fmt(best),
  `naive p ${fmt(forcedChoiceTest(Math.max(...batchHits), perBatch, 1 / 4).pOneSided)}`,
)
console.log('  best-of-5 p      ', fmt(maxOfLooksPValue(best, batches)))
console.log(
  '  E[best of 5 | H0]',
  fmt(expectedMaxOfLooks(batches).exact),
  `bar at α = 0.05: ${fmt(deflatedCriticalValue(batches).z)}`,
)

// 3. Zener runs: a shuffled closed 5 × 5 pack against a balanced call sequence.
const runs = size(args, 20, 4)
const pack = [5, 5, 5, 5, 5]
let zenerHits = 0
for (let r = 0; r < runs; r++) {
  const cards = (await drawWithoutReplacement(targets, 25, 25)).map((i) => Math.floor(i / 5))
  const calls = (await drawWithoutReplacement(receiver, 25, 25)).map((i) => Math.floor(i / 5))
  zenerHits += cards.filter((card, i) => card === calls[i]).length
}
await targets.close()
await receiver.close()
const zener = closedDeckTest(zenerHits, pack, { callCounts: pack, runs })
console.log('zener              ', `${zenerHits} hits in ${runs} runs of 25 (mean ${zener.mean})`)
console.log(
  '  exact closed deck',
  `CR ${fmt(zener.criticalRatio)}`,
  `P(X ≥ ${zenerHits}) ${fmt(zener.pOneSided)}`,
)
console.log(
  '  binomial shortcut',
  `CR ${fmt(zener.openDeckCriticalRatio)}`,
  `run SD ${fmt(zener.distribution.sd)} vs 2`,
)
