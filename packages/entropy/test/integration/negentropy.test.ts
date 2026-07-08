/**
 * Cross-package contract: every EntropyProvider must satisfy negentropy's
 * structural TrialSource — the packages share no code, only this shape.
 * Imported by source path (not the package specifier) so entropy's
 * typecheck/tests never depend on a prior negentropy dist build.
 */
import { describe, expect, test } from 'bun:test'
import type { TrialSource } from '../../../negentropy/src/index.js'
import { analyzeBytes, session } from '../../../negentropy/src/index.js'
import { cryptoProvider } from '../../src/providers/crypto.js'
import { drand } from '../../src/providers/drand.js'
import type { EntropyProvider } from '../../src/types.js'

const LIVE = process.env.LIVE === '1'

/** Distinct-named view over a provider (session requires unique source names). */
function named(name: string, provider: EntropyProvider): TrialSource {
  return { name, stream: (opts) => provider.stream(opts) }
}

describe('EntropyProvider ⊆ TrialSource', () => {
  test('assignability holds at compile time and runtime', () => {
    const provider: EntropyProvider = cryptoProvider()
    const source: TrialSource = provider // the structural contract, checked by tsc
    expect(source.name).toBe('crypto')
    expect(typeof source.stream).toBe('function')
  })

  test('a 3-source live session over crypto providers ticks and analyzes', async () => {
    const live = session({
      sources: [
        named('crypto-a', cryptoProvider()),
        named('crypto-b', cryptoProvider()),
        named('crypto-c', cryptoProvider()),
      ],
      events: [{ id: 'all', statistic: 'netvar', start: 0, end: 20 }],
    })
    let ticks = 0
    for await (const tick of live) {
      expect(tick.present.length).toBe(3)
      if (++ticks === 20) break
    }
    const result = live.stop()
    expect(result.events[0]?.steps).toBe(20)
    expect(result.events[0]?.pValue).toBeGreaterThan(0)
    expect(result.events[0]?.pValue).toBeLessThanOrEqual(1)
    expect(result.series.length).toBe(3)
  })

  test('analyzeBytes consumes getBytes output directly', async () => {
    const provider = cryptoProvider()
    const recordings = await Promise.all(
      ['a', 'b'].map(async (suffix) => ({
        source: `crypto-${suffix}`,
        bytes: (await provider.getBytes(500 * 25)).bytes,
      })),
    )
    const result = analyzeBytes(recordings, {
      events: [{ id: 'e', statistic: 'devvar', start: 0, end: 500 }],
    })
    // a CSPRNG must look null
    expect(result.events[0]?.pValue).toBeGreaterThan(0.0001)
  })

  test.skipIf(!LIVE)(
    'LIVE: a short mixed session over drand + crypto',
    async () => {
      const live = session({
        sources: [named('drand', drand()), named('crypto', cryptoProvider())],
        trial: { bitsPerTrial: 64 },
      })
      let ticks = 0
      for await (const tick of live) {
        expect(Number.isFinite(tick.stouffer)).toBe(true)
        if (++ticks === 2) break
      }
      const result = live.stop()
      expect(result.series[0]?.sums.length).toBeGreaterThanOrEqual(2)
    },
    30_000,
  )
})
