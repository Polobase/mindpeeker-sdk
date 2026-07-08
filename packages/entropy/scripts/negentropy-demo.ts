/**
 * Live negentropy demo: a GCP-style session over three crypto providers
 * (add LIVE=1 to include the drand beacon), one 500ms-bucketed trial per
 * tick, with a final batch analysis and a cumulative-deviation sparkline.
 *
 *   bun scripts/negentropy-demo.ts [seconds]
 */

import type { TrialSource } from '../../negentropy/src/index.js'
import { session, significanceEnvelope } from '../../negentropy/src/index.js'
import { cryptoProvider } from '../src/providers/crypto.js'
import { drand } from '../src/providers/drand.js'
import type { EntropyProvider } from '../src/types.js'

const seconds = Number(process.argv[2] ?? 10)
const named = (name: string, provider: EntropyProvider): TrialSource => ({
  name,
  stream: (opts) => provider.stream(opts),
})

const sources: TrialSource[] = [
  named('crypto-a', cryptoProvider()),
  named('crypto-b', cryptoProvider()),
  named('crypto-c', cryptoProvider()),
]
if (process.env.LIVE === '1') sources.push(named('drand', drand()))

const expectedTicks = Math.max(4, Math.floor(seconds * 2))
const live = session({
  sources,
  trial: { clock: { mode: 'interval', intervalMs: 500 } },
  missing: 'skip',
  events: [{ id: 'demo', label: 'whole run', statistic: 'netvar', start: 0, end: expectedTicks }],
})

console.log(`sources: ${sources.map((s) => s.name).join(', ')} — running ~${seconds}s\n`)
const cumdevs: number[] = []
const deadline = Date.now() + seconds * 1000
for await (const tick of live) {
  cumdevs.push(tick.cumdev)
  console.log(
    `tick ${String(tick.step).padStart(3)}  Z=${tick.stouffer.toFixed(2).padStart(6)}  ` +
      `netvar=${tick.netvar.toFixed(1).padStart(7)}  cumdev=${tick.cumdev.toFixed(1).padStart(7)}  ` +
      `[${tick.present.join(' ')}]`,
  )
  if (Date.now() >= deadline) break
}
const result = live.stop()

const blocks = '▁▂▃▄▅▆▇█'
const lo = Math.min(...cumdevs, 0)
const hi = Math.max(...cumdevs, 1)
const sparkline = cumdevs
  .map((d) => blocks[Math.min(7, Math.floor(((d - lo) / (hi - lo || 1)) * 8))])
  .join('')
const envelope = significanceEnvelope(Math.max(cumdevs.length, 1))

console.log(`\ncumdev  ${sparkline}`)
console.log(`p=0.05 envelope at final step: +${envelope[cumdevs.length - 1]?.toFixed(1)}`)
for (const event of result.events) {
  console.log(
    `event "${event.id}" (${event.statistic}): χ²=${event.value.toFixed(1)} on ${event.df} df → p=${event.pValue.toFixed(4)} (z=${event.z.toFixed(2)})`,
  )
}
console.log('a CSPRNG should look null — structure here would mean a bug, not psi')
