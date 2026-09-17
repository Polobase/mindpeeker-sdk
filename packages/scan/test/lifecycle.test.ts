import { describe, expect, test } from 'bun:test'
import { broadcast } from '../src/broadcast/broadcast.js'
import { defineCatalog } from '../src/catalog.js'
import { scanDeviation } from '../src/scan/deviation.js'
import { scan } from '../src/scan/scan.js'
import { sweepScan } from '../src/scan/sweep.js'
import { generalVitality } from '../src/scan/vitality.js'
import type { StreamLog } from './helpers/byte-sources.js'
import { codedError, failingSource, prngBytes, trackedSource } from './helpers/byte-sources.js'

const RATE = { digits: [12, 33, 7], base: 44 }
const cat = defineCatalog(
  'kit',
  'Kit',
  ['Arnica', 'Bryonia', 'Calendula', 'Drosera'].map((name) => ({ name })),
)

/** The source's `finally` has run for every session it opened. */
function released(log: StreamLog): void {
  expect(log.opened).toBe(1)
  expect(log.closed).toBe(1)
}

describe('every entry point releases the source stream it opens', () => {
  test('on natural completion', async () => {
    const bytes = prngBytes(4096, 11)
    let t = trackedSource('esp32', bytes)
    await scan(cat, t.source, { deviationRounds: 16 })
    released(t.log)
    t = trackedSource('esp32', bytes)
    await scanDeviation(cat, t.source, { rounds: 16 })
    released(t.log)
    t = trackedSource('esp32', bytes)
    await generalVitality(t.source)
    released(t.log)
    t = trackedSource('esp32', bytes)
    await sweepScan({ dials: 3, positions: 10 }, t.source)
    released(t.log)
    t = trackedSource('esp32', bytes)
    const gen = broadcast(RATE, t.source, { rounds: 3, roundBytes: 8 })
    for (let s = await gen.next(); !s.done; s = await gen.next()) {
      // drain
    }
    released(t.log)
  })

  test('when the broadcast consumer stops early (return / break)', async () => {
    const t = trackedSource('esp32', prngBytes(4096, 12))
    const gen = broadcast(RATE, t.source, { rounds: 1000, roundBytes: 8 })
    await gen.next()
    await gen.return(undefined as never)
    released(t.log)

    const u = trackedSource('esp32', prngBytes(4096, 13))
    let seen = 0
    for await (const _tick of broadcast(RATE, u.source, { rounds: 1000, roundBytes: 8 })) {
      if (++seen === 2) break
    }
    released(u.log)
  })

  test('when aborted mid-run, even by a slow source that ignores the signal', async () => {
    const t = trackedSource('slow', prngBytes(4096, 14), { chunkBytes: 4, delayMs: 2 })
    const ac = new AbortController()
    const run = scan(cat, t.source, { deviationRounds: 4096, signal: ac.signal })
    setTimeout(() => ac.abort(), 15)
    await expect(run).rejects.toMatchObject({ name: 'ScanError', code: 'aborted' })
    await Bun.sleep(20)
    expect(t.log.closed).toBe(t.log.opened)

    const u = trackedSource('slow', prngBytes(4096, 15), { chunkBytes: 4, delayMs: 2 })
    const bc = new AbortController()
    const gen = broadcast(RATE, u.source, { rounds: 1000, roundBytes: 8, signal: bc.signal })
    await gen.next()
    bc.abort()
    await expect(gen.next()).rejects.toMatchObject({ code: 'aborted' })
    await Bun.sleep(20)
    expect(u.log.closed).toBe(u.log.opened)
  })

  test('when the source ends or fails', async () => {
    const t = trackedSource('finite', prngBytes(3, 16), { finite: true })
    await expect(scanDeviation(cat, t.source, { rounds: 64 })).rejects.toMatchObject({
      code: 'insufficient_entropy',
    })
    released(t.log)
    const health = codedError('EntropyError', 'health_test', 'APT alarm')
    await expect(generalVitality(failingSource('esp32', health, 0))).rejects.toMatchObject({
      code: 'source_error',
      cause: health,
    })
  })
})
