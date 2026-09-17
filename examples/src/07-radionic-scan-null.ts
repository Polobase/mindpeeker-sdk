/**
 * Recipe 7: a radionic catalog scan with an honest null. Deviation mode on a fair
 * source (expect nulls), then the same scan on a deliberately biased fake source.
 * bun examples/src/07-radionic-scan-null.ts [--source crypto] [--control offline] [--smoke]
 */
import { defineCatalog, type ScanReport, scan } from '@mindpeeker/scan'
import { fmt, openSource, parseArgs, size } from './lib/cli.js'

const args = parseArgs()
const items = size(args, 60, 12)
const rounds = size(args, 256, 64) // one fair coin per item per round: p0 = 1/2 exactly
const catalog = defineCatalog(
  'demo',
  'Demo catalog',
  Array.from({ length: items }, (_, i) => ({ id: `item-${i + 1}`, name: `Item ${i + 1}` })),
)

// A fake source with a known defect: every bit is a | (b & c) of three fair bits, P(1) = 5/8.
const input = openSource(args.control, 'bias-input')
const biased = {
  name: 'biased-5/8',
  async *stream(opts?: { signal?: AbortSignal; chunkBytes?: number }) {
    let carry: number[] = []
    for await (const chunk of input.stream(opts)) {
      const bytes = [...carry, ...chunk]
      const out = new Uint8Array(Math.floor(bytes.length / 3))
      for (let i = 0; i < out.length; i++) {
        out[i] =
          (bytes[3 * i] as number) | ((bytes[3 * i + 1] as number) & (bytes[3 * i + 2] as number))
      }
      carry = bytes.slice(3 * out.length)
      if (out.length > 0) yield out
    }
  },
}

function print(label: string, report: ScanReport): void {
  const m = report.multiplicity
  if (!m) throw new Error('deviation mode always reports multiplicity')
  const bfs = report.results
    .map((r) => r.deviation?.bayesFactor ?? Number.NaN)
    .sort((a, b) => a - b)
  console.log(`${label}: ${report.source}, ${m.tests} items × ${rounds} rounds`)
  console.log('  p ≤ 0.05 expected ', fmt(m.expectedFalsePositives, 1), `observed ${m.nominalHits}`)
  console.log('  after Holm / BH   ', m.holmRejections, '/', m.bhRejections)
  console.log(
    '  omnibus Σz²       ',
    fmt(m.omnibus.statistic, 1),
    `df ${m.omnibus.df}`,
    `p ${fmt(m.omnibus.p)}`,
  )
  console.log('  median BF10       ', fmt(bfs[Math.floor(bfs.length / 2)] as number))
  for (const r of report.results.slice(0, 3)) {
    const d = r.deviation
    if (d)
      console.log(
        `  rank ${r.rank} ${r.id}`.padEnd(20),
        `${d.successes}/${d.rounds}`,
        `p ${fmt(d.p)}`,
        `Holm ${fmt(d.pHolm)}`,
      )
  }
}

const scanOpts = { mode: 'deviation', deviationRounds: rounds } as const
print('fair source', await scan(catalog, openSource(args.source, 'scan'), scanOpts))
print('biased source', await scan(catalog, biased, scanOpts))
