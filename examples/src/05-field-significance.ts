/**
 * Recipe 5: is my point field special? Single-point tails versus calibrated whole-field
 * p-values and a global envelope test, on a random field and on a planted cluster.
 * bun examples/src/05-field-significance.ts [--source crypto] [--smoke]
 */
import {
  attractors,
  csrEnvelope,
  fieldSignificance,
  type Point,
  sampleField,
} from '@mindpeeker/field'
import { byteReader } from '@mindpeeker/oracle'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'

const args = parseArgs()
const region = { kind: 'rect', width: 100, height: 80 } as const
const n = size(args, 300, 60)
const runs = size(args, 499, 39) // simulated CSR fields per test: p resolution 1/(runs + 1)
const radii = [2, 4, 6, 8, 10, 14] // registered before drawing
const reader = byteReader(openSource(args.source, 'field')) // one reader: disjoint bytes per call

async function report(label: string, points: readonly Point[]): Promise<void> {
  const { attractor, void: empty, radius } = attractors(points, region)
  const whole = await fieldSignificance(reader, points, region, { runs })
  const envelope = await csrEnvelope(points, reader, region, radii, { runs })
  console.log(`${label} (n = ${points.length}, radius ${fmt(radius, 2)})`)
  console.log(
    '  attractor        ',
    `${attractor.neighbours} neighbours, expected ${fmt(attractor.expected, 2)}`,
    `pSingle ${fmt(attractor.pSingle)}`,
    `whole-field p ${fmt(whole.attractor.p)}`,
  )
  console.log(
    '  void             ',
    `${empty.neighbours} neighbours, expected ${fmt(empty.expected, 2)}`,
    `pSingle ${fmt(empty.pSingle)}`,
    `whole-field p ${fmt(whole.void.p)}`,
  )
  console.log(
    '  L(r) − r envelope',
    `global rank p ${fmt(envelope.global.p)}`,
    `MAD p ${fmt(envelope.global.mad.p)}`,
    `smallest pointwise p ${fmt(Math.min(...envelope.pointwiseP))}`,
  )
}

// 1. A field drawn from the source: its densest point always looks like an "attractor".
const { points, accounting } = await sampleField(reader, n, region)
await report('random field', points)

// 2. Positive control: replace 5% of the points by a tight cluster at the centre.
const k = Math.round(n * 0.05)
const { points: blob } = await sampleField(reader, k, { kind: 'disk', radius: 3 })
const planted = [...points.slice(k), ...blob.map((p) => ({ x: 50 + p.x, y: 40 + p.y }))]
await report('planted cluster', planted)

await reader.close()
console.log('bytes per field    ', accounting.bytesConsumed, '(8 per point)')
