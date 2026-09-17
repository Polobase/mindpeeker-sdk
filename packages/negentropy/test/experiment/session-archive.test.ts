import { describe, expect, test } from 'bun:test'
import { analyzeTrials } from '../../src/experiment/batch.js'
import type { SessionTick } from '../../src/experiment/session.js'
import { session } from '../../src/experiment/session.js'
import type { TrialSource, TrialStreamOptions } from '../../src/types.js'
import { prngBytes } from '../helpers/byte-sources.js'

/** Endless source yielding one full 200-bit trial per 25-byte chunk. */
function instantSource(name: string, seed: number): TrialSource {
  return {
    name,
    async *stream() {
      let round = seed
      while (true) yield prngBytes(25, round++)
    },
  }
}

/** Source that yields one trial per `release()` — presence is under test control. */
function gatedSource(name: string, seed: number) {
  let open: (() => void) | null = null
  let credits = 0
  let seen: AbortSignal | undefined
  let finalized = false
  const source: TrialSource = {
    name,
    async *stream(opts?: TrialStreamOptions) {
      seen = opts?.signal
      let round = seed
      try {
        while (true) {
          if (credits === 0) {
            // honours the forwarded signal, as real providers do: abort ends the wait
            await new Promise<void>((resolve) => {
              open = resolve
              opts?.signal?.addEventListener('abort', () => resolve(), { once: true })
            })
            if (opts?.signal?.aborted) return
          }
          credits--
          yield prngBytes(25, round++)
        }
      } finally {
        finalized = true
      }
    },
  }
  return {
    source,
    release() {
      credits++
      open?.()
      open = null
    },
    get signal() {
      return seen
    },
    get finalized() {
      return finalized
    },
  }
}

/** Yields `count` trials, then ends. */
function finiteSource(name: string, count: number, seed: number): TrialSource {
  return {
    name,
    async *stream() {
      for (let i = 0; i < count; i++) yield prngBytes(25, seed + i)
    },
  }
}

/** Deep copy with typed arrays as plain arrays and NaN spelled out (toEqual treats typed-array NaN as unequal). */
function printable(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_, v) =>
      ArrayBuffer.isView(v)
        ? Array.from(v as Float64Array, (x) => (Number.isNaN(x) ? 'NaN' : x))
        : Number.isNaN(v)
          ? 'NaN'
          : v,
    ),
  )
}

const tick = async (it: AsyncIterator<SessionTick>) => (await it.next()).value as SessionTick

describe("session archive under missing: 'skip'", () => {
  test('one row per tick per source, NaN when absent; stop() reproduces the live statistics', async () => {
    const gated = gatedSource('slow', 0x5a)
    const live = session({
      sources: [instantSource('fast', 0x11), gated.source],
      missing: 'skip',
      stepTimeoutMs: 20,
      events: [
        { id: 'first', statistic: 'netvar', start: 0, end: 6 },
        { id: 'dev', statistic: 'devvar', start: 0, end: 6 },
      ],
    })
    const it = live[Symbol.asyncIterator]()
    const ticks: SessionTick[] = []
    const plan = [false, true, false, false, true, true, false] // is 'slow' released this round?
    for (const released of plan) {
      if (released) gated.release()
      ticks.push(await tick(it))
    }
    expect(ticks.map((t) => t.present.length)).toEqual(plan.map((r) => (r ? 2 : 1)))
    const archive = live.series()
    expect(archive.map((s) => s.sums.length)).toEqual([7, 7])
    ticks.forEach((t, step) => {
      expect(Number.isNaN(archive[1]?.sums[step] as number)).toBe(!plan[step])
      expect(archive[0]?.timestamps?.[step]).toBe(t.at)
    })
    const result = live.stop()
    expect(printable(result.series)).toEqual(printable(archive))
    expect(result.analysedSteps).toBe(7)
    // the batch analysis of the archive equals the live running values exactly
    expect(result.events[0]).toMatchObject({ status: 'complete', df: 6 })
    expect(result.events[0]?.value).toBe(ticks[5]?.netvar as number)
    expect(result.events[0]?.cumulative[5]).toBe(ticks[5]?.cumdev as number)
    expect(result.events[1]?.df).toBe(6 + 3) // present cells in steps 0..5 (slow at 1, 4, 5)
    expect(result.composite.independent).toBe(false) // same window twice → Brown
    const again = analyzeTrials(result.series, {
      missing: 'skip',
      events: [
        { id: 'first', statistic: 'netvar', start: 0, end: 6 },
        { id: 'dev', statistic: 'devvar', start: 0, end: 6 },
      ],
      calibration: result.calibration,
    })
    expect(printable(again)).toEqual(printable(result))
  })

  test('burn-in honours skip: a source that ends during calibration leaves the roster', async () => {
    const live = session({
      sources: [instantSource('a', 0x21), finiteSource('short', 5, 0x22), instantSource('b', 0x23)],
      missing: 'skip',
      calibration: { trials: 10 },
      events: [{ id: 'e', statistic: 'netvar', start: 0, end: 4 }],
    })
    const it = live[Symbol.asyncIterator]()
    for (let i = 0; i < 4; i++) {
      const t = await tick(it)
      expect(t.present).toEqual(['a', 'b'])
      expect(Number.isNaN(t.zBySource[1] as number)).toBe(true)
    }
    const result = live.stop()
    expect(result.series.map((s) => s.source)).toEqual(['a', 'b'])
    expect(result.calibration.map((c) => c.source)).toEqual(['a', 'b'])
    expect(result.events[0]?.status).toBe('complete')

    // a source that stalls during burn-in is dropped too, and released at once
    const stalled = gatedSource('stalled', 0x24)
    const tolerant = session({
      sources: [instantSource('a', 0x21), stalled.source],
      missing: 'skip',
      stepTimeoutMs: 20,
      calibration: { trials: 10 },
    })
    const first = await tick(tolerant[Symbol.asyncIterator]())
    expect(first.present).toEqual(['a'])
    expect(stalled.signal?.aborted).toBe(true)
    expect(tolerant.stop().series.map((s) => s.source)).toEqual(['a'])

    const strict = session({
      sources: [instantSource('a', 0x21), finiteSource('short', 5, 0x22)],
      calibration: { trials: 10 },
    })
    await expect(strict[Symbol.asyncIterator]().next()).rejects.toMatchObject({
      code: 'source_ended',
      source: 'short',
    })
  })
})

describe('session stop() is total', () => {
  test('unelapsed windows come back incomplete; the recording is kept', async () => {
    const live = session({
      sources: [instantSource('a', 0x31), instantSource('b', 0x32)],
      events: [
        { id: 'long', statistic: 'netvar', start: 0, end: 100 },
        { id: 'short', statistic: 'correlation', start: 0, end: 3 },
        {
          id: 'future',
          statistic: 'devvar',
          start: new Date(Date.now() + 3_600_000),
          end: new Date(Date.now() + 7_200_000),
        },
      ],
    })
    const it = live[Symbol.asyncIterator]()
    for (let i = 0; i < 5; i++) await tick(it)
    const result = live.stop()
    expect(result.events.map((e) => [e.id, e.status, e.steps])).toEqual([
      ['long', 'incomplete', 5],
      ['short', 'complete', 3],
      ['future', 'incomplete', 0],
    ])
    expect(result.series.map((s) => s.sums.length)).toEqual([5, 5])
    expect(live.stop()).toEqual(result) // idempotent
    expect(await it.next()).toEqual({ done: true, value: undefined })
  })

  test('before the first tick and during burn-in', async () => {
    const provided = session({
      sources: [instantSource('a', 0x41)],
      calibration: [
        { source: 'a', bitsPerTrial: 200, trials: 500, mean: 100, sd: 7, basis: 'empirical' },
      ],
      events: [{ id: 'e', statistic: 'netvar', start: 0, end: 5 }],
    })
    const early = provided.stop()
    expect(early.calibration[0]?.mean).toBe(100)
    expect(early.series[0]?.sums.length).toBe(0)
    expect(early.events[0]?.status).toBe('incomplete')

    const gated = gatedSource('g', 0x42)
    const burning = session({
      sources: [gated.source],
      calibration: { trials: 50 },
      stepTimeoutMs: Number.POSITIVE_INFINITY,
      events: [{ id: 'e', statistic: 'netvar', start: 0, end: 5 }],
    })
    const pending = burning[Symbol.asyncIterator]().next()
    await Bun.sleep(5)
    const stopped = burning.stop()
    expect(stopped.calibration).toEqual([])
    expect(stopped.events[0]).toMatchObject({ status: 'incomplete', steps: 0 })
    expect(stopped.events[0]?.reason).toContain('calibration')
    expect(await pending).toEqual({ done: true, value: undefined }) // ends cleanly, no throw
  })
})

describe('session timeouts, abort and source release', () => {
  test('stepTimeoutMs: Infinity waits as long as needed (no 1 ms overflow)', async () => {
    const slow: TrialSource = {
      name: 'slow',
      async *stream() {
        let round = 1
        while (true) {
          await Bun.sleep(30)
          yield prngBytes(25, round++)
        }
      },
    }
    const live = session({ sources: [slow], stepTimeoutMs: Number.POSITIVE_INFINITY })
    const it = live[Symbol.asyncIterator]()
    expect((await tick(it)).present).toEqual(['slow'])
    expect((await tick(it)).step).toBe(1)
    live.stop()
  })

  test('the session owns an AbortController: stop() aborts the signal every source.stream() saw', async () => {
    const gated = gatedSource('g', 0x51)
    const live = session({ sources: [gated.source], stepTimeoutMs: Number.POSITIVE_INFINITY })
    const it = live[Symbol.asyncIterator]()
    const pending = it.next()
    await Bun.sleep(5)
    expect(gated.signal?.aborted).toBe(false)
    live.stop()
    expect(gated.signal?.aborted).toBe(true)
    expect(await pending).toEqual({ done: true, value: undefined })
    await Bun.sleep(150) // trialStream's bounded cleanup grace
    expect(gated.finalized).toBe(true)
  })

  test("caller abort pre-empts a blocked round and removes its listener from the caller's signal", async () => {
    const controller = new AbortController()
    const signal = controller.signal
    let listeners = 0
    const add = signal.addEventListener.bind(signal)
    const remove = signal.removeEventListener.bind(signal)
    signal.addEventListener = ((...args: Parameters<typeof add>) => {
      listeners++
      add(...args)
    }) as typeof signal.addEventListener
    signal.removeEventListener = ((...args: Parameters<typeof remove>) => {
      listeners--
      remove(...args)
    }) as typeof signal.removeEventListener

    // a finished run leaves no listener behind on a long-lived signal
    const quick = session({ sources: [finiteSource('f', 2, 0x61)], missing: 'skip', signal })
    for await (const _ of quick) {
      // drain
    }
    expect(listeners).toBe(0)

    const gated = gatedSource('g', 0x62)
    const live = session({
      sources: [gated.source],
      stepTimeoutMs: Number.POSITIVE_INFINITY,
      signal,
    })
    const pending = live[Symbol.asyncIterator]().next()
    await Bun.sleep(5)
    const started = performance.now()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    expect(performance.now() - started).toBeLessThan(50)
    expect(listeners).toBe(0)
    expect(gated.signal?.aborted).toBe(true)
    expect(live.stop().series[0]?.sums.length).toBe(0) // still total after an abort
  })
})
