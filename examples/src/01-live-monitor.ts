/**
 * Recipe 1: a live negentropy monitor with an anytime-valid boundary.
 * bun examples/src/01-live-monitor.ts [--source crypto] [--control offline] [--smoke]
 */
import {
  anytimeEnvelope,
  anytimeP,
  cumulativeDeviation,
  netvarMartingale,
  probitBytes,
  session,
  significanceEnvelope,
} from '@mindpeeker/negentropy'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'

const args = parseArgs()
const steps = size(args, 3000, 300)
const alpha = 0.05
const pointwise = significanceEnvelope(steps, alpha) // χ² upper quantile − t, per step
const anytime = anytimeEnvelope(steps, alpha, { sided: 'upper' }).upper // D_t ≥ upper ⇔ M_t ≥ 1/α

// 1. Watch three sources in lock-step: one 200-bit trial per source per step.
const sources = ['egg-1', 'egg-2', 'egg-3'].map((label) => openSource(args.source, label))
const live = session({ sources, events: [], stepTimeoutMs: 60_000 })
const stouffer: number[] = []
const logE: number[] = []
let firstPointwise = 0
let firstAnytime = 0
for await (const tick of live) {
  stouffer.push(tick.stouffer)
  logE.push(tick.logEValue)
  const t = tick.step + 1
  if (!firstPointwise && tick.cumdev > (pointwise[tick.step] as number)) firstPointwise = t
  if (!firstAnytime && tick.eValue >= 1 / alpha) firstAnytime = t
  if (t >= steps) break
}
const result = live.stop() // total: the full step-aligned archive, never throws

const batch = netvarMartingale(stouffer, { sided: 'upper' })
console.log('sources            ', sources.map((s) => s.name).join(', '))
console.log('steps analysed     ', result.analysedSteps)
console.log('final cumdev D_t   ', fmt(cumulativeDeviation(stouffer).at(-1) ?? Number.NaN))
console.log('final e-value M_t  ', fmt(Math.exp(logE.at(-1) ?? Number.NaN)))
console.log('anytime p          ', fmt(anytimeP(logE).at(-1) ?? Number.NaN))
console.log('pointwise crossing ', firstPointwise ? `step ${firstPointwise}` : 'none')
console.log('anytime crossing   ', firstAnytime ? `step ${firstAnytime}` : 'none')
console.log('live = batch       ', batch.at(-1) === logE.at(-1))

// 2. Why the pointwise envelope cannot be watched: simulate H0 paths and look at every step.
const paths = size(args, 400, 20)
const { bytes } = await openSource(args.control, 'null-paths').getBytes(paths * steps)
let crossedPointwise = 0
let crossedAnytime = 0
for (let p = 0; p < paths; p++) {
  const zs = probitBytes(bytes.subarray(p * steps, (p + 1) * steps), { source: `path-${p}` })
  const curve = cumulativeDeviation(zs) // exactly N(0, 1) steps under H0
  if (curve.some((d, t) => d > (pointwise[t] as number))) crossedPointwise++
  if (curve.some((d, t) => d >= (anytime[t] as number))) crossedAnytime++
}
for (const t of [100, 1000, steps].filter((t) => t <= steps)) {
  const i = t - 1
  console.log(`bands at t=${t}`.padEnd(19), fmt(pointwise[i] as number), fmt(anytime[i] as number))
}
console.log('H0 paths crossing  ', `pointwise ${crossedPointwise}/${paths}`)
console.log('                   ', `anytime   ${crossedAnytime}/${paths} (Ville: ≤ ${alpha})`)
