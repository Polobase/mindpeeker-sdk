/**
 * Recipe 6: pricing a gematria coincidence. Equal values in a lexicon, the exact
 * probability that random words collide, and a draw-based check of that probability.
 * bun examples/src/06-gematria-coincidence.ts [--source crypto] [--smoke]
 */
import {
  birthdayMatch,
  noMatchNonUniform,
  peopleForKWayMatch,
  peopleForMatch,
} from '@mindpeeker/coincidence'
import { collisionProfile, lookup, matches, value } from '@mindpeeker/gematria'
import { defaultLexicon } from '@mindpeeker/gematria/lexicon'
import { byteReader, uniformInt } from '@mindpeeker/oracle'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'

const args = parseArgs()
const cipher = 'he-hechrachi'
const words = defaultLexicon(cipher) // registers the bundled corpus; Hebrew words only

// 1. The "discovery": words that share a value.
const truth = matches('אמת', cipher)
const messiah = lookup(358, cipher, { colel: true })
console.log(
  'אמת                ',
  truth.value,
  truth.matches.join(' '),
  `commonness ${fmt(truth.commonness)}`,
)
console.log(
  '358 ± 1            ',
  messiah.matches.join(' · '),
  `commonness ${fmt(messiah.commonness)}`,
)

// 2. Price equal values for the whole lexicon before looking at any word.
const profile = collisionProfile(words, cipher)
const probs = profile.histogram.map((bin) => bin.probability)
console.log('lexicon            ', `${profile.n} words, ${profile.distinct} distinct values`)
console.log('two random words   ', `share a value with q = ${fmt(profile.collisionProbability)}`)
console.log('equal pairs        ', `${profile.observedEqualPairs} observed among the entries`)
for (const draws of [5, 10, 20]) {
  const uneven = noMatchNonUniform(draws, probs).match // the real value histogram
  const even = birthdayMatch(draws, profile.distinct) // if every value were equally likely
  console.log(
    `${draws} random words`.padEnd(19),
    `P(shared value) ${fmt(uneven)} (equal values: ${fmt(even)})`,
  )
}
console.log(
  'words for 50%      ',
  `${peopleForKWayMatch(0.5, probs, 2)} exact (equal values: ${peopleForMatch(0.5, profile.distinct)})`,
)

// 3. Check the exact number by drawing 10 words with replacement, many times.
const trials = size(args, 20_000, 200)
const values = words.map((word) => value(word, cipher))
const reader = byteReader(openSource(args.source, 'lexicon-draws'))
let collisions = 0
for (let t = 0; t < trials; t++) {
  const seen = new Set<number>()
  let hit = false
  for (let d = 0; d < 10; d++) {
    const v = values[await uniformInt(reader, values.length)] as number
    hit ||= seen.has(v)
    seen.add(v)
  }
  if (hit) collisions++
}
await reader.close()
const exact = noMatchNonUniform(10, probs).match
const se = Math.sqrt((exact * (1 - exact)) / trials)
console.log(
  'drawn, 10 words    ',
  `${fmt(collisions / trials)} over ${trials} draws (exact ${fmt(exact)} ± ${fmt(se)} SE)`,
)
