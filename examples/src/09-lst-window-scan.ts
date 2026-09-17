/**
 * Recipe 9: a local-sidereal-time scan with a planted effect, its scan-aware permutation
 * test, and a confirmatory test of one registered window on fresh data.
 * bun examples/src/09-lst-window-scan.ts [--source crypto] [--smoke]
 */
import {
  julianDay,
  type LstTimedTrial,
  lst,
  lstPermutationTest,
  lstWindowTest,
} from '@mindpeeker/ephemeris'
import { probitBytes } from '@mindpeeker/negentropy'
import { byteReader, uniformInt } from '@mindpeeker/oracle'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'

const args = parseArgs()
const n = size(args, 1200, 150)
const permutations = size(args, 9999, 199)
const seed = 20260917
const labs = [
  { id: 'edinburgh', lon: -3.19 },
  { id: 'zurich', lon: 8.54 },
  { id: 'palo-alto', lon: -122.14 },
]
const plant = { centerHours: 20, halfWidthHours: 1, shift: 0.6 } // the simulated "true" effect
const reader = byteReader(openSource(args.source, 'lst'))

/** Simulated sessions over two years, 09:00–17:00 local mean time, effect ~ N(0, 1) (+ shift). */
async function study(tag: string, shift: number): Promise<LstTimedTrial[]> {
  const bytes = new Uint8Array(n)
  for (let i = 0; i < n; i++) bytes[i] = await uniformInt(reader, 256)
  const noise = probitBytes(bytes, { source: tag }) // exactly N(0, 1) under H0
  const trials: LstTimedTrial[] = []
  for (let i = 0; i < n; i++) {
    const lab = labs[await uniformInt(reader, labs.length)] as (typeof labs)[number]
    const day = await uniformInt(reader, 730)
    const localMinutes = 9 * 60 + (await uniformInt(reader, 8 * 60))
    const utcMinutes = day * 1440 + localMinutes - (lab.lon / 15) * 60
    const time = new Date(Date.UTC(2024, 0, 1) + Math.round(utcMinutes * 60_000))
    const hours = lst(julianDay(time), lab.lon)
    const distance = Math.abs(((hours - plant.centerHours + 36) % 24) - 12)
    const effect = (noise[i] as number) + (distance < plant.halfWidthHours ? shift : 0)
    trials.push({ time, longitudeEastDeg: lab.lon, effect, stratum: lab.id })
  }
  return trials
}

// 1. Exploration: scan all 240 windows; the permutation null repeats the whole search.
let explored = 0
for (const [label, shift] of [
  ['null study', 0],
  ['planted study', plant.shift],
] as const) {
  const result = lstPermutationTest(await study(label, shift), { permutations, seed })
  const peak = result.scan.peak
  if (shift > 0) explored = Math.round(peak.centroidHours * 2) / 2 // nearest half hour
  console.log(
    label.padEnd(19),
    `peak ${fmt(peak.centerHours, 1)} h (centroid ${fmt(peak.centroidHours, 2)} h, n ${peak.n})`,
    `mean ${fmt(peak.mean, 3)}`,
    `scan p ${fmt(result.pValue)} (${result.exceedances}/${result.permutations}, ${result.strata} strata)`,
  )
}

// 2. Confirmation: register one window from the exploration, then test it on NEW data.
const registered = { centerHours: explored, halfWidthHours: 1 }
console.log('registered window  ', `${registered.centerHours} h ± ${registered.halfWidthHours} h`)
for (const [label, shift] of [
  ['confirm, no effect', 0],
  ['confirm, effect', plant.shift],
] as const) {
  const test = lstWindowTest(await study(label, shift), { ...registered, permutations, seed })
  console.log(
    label.padEnd(19),
    `inside ${fmt(test.inside.mean, 3)} (n ${test.inside.n}) vs outside ${fmt(test.outside.mean, 3)}`,
    `p ${fmt(test.pValue)}`,
  )
}
await reader.close()
