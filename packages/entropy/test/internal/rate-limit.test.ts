import { describe, expect, test } from 'bun:test'
import { MinIntervalGate, sleep } from '../../src/internal/rate-limit.js'

describe('MinIntervalGate', () => {
  test('first wait resolves immediately', async () => {
    const gate = new MinIntervalGate(50)
    const start = Date.now()
    await gate.wait()
    expect(Date.now() - start).toBeLessThan(20)
  })

  test('second wait is delayed by the interval', async () => {
    const gate = new MinIntervalGate(40)
    const start = Date.now()
    await gate.wait()
    await gate.wait()
    expect(Date.now() - start).toBeGreaterThanOrEqual(35)
  })

  test('an interval of 0 never delays', async () => {
    const gate = new MinIntervalGate(0)
    const start = Date.now()
    await gate.wait()
    await gate.wait()
    await gate.wait()
    expect(Date.now() - start).toBeLessThan(20)
  })

  test('defer pushes the next slot into the future', async () => {
    const gate = new MinIntervalGate(0)
    await gate.wait()
    gate.defer(40)
    const start = Date.now()
    await gate.wait()
    expect(Date.now() - start).toBeGreaterThanOrEqual(35)
  })

  test('concurrent waiters are serialized one interval apart', async () => {
    const gate = new MinIntervalGate(25)
    const start = Date.now()
    const stamps: number[] = []
    await Promise.all([
      gate.wait().then(() => stamps.push(Date.now() - start)),
      gate.wait().then(() => stamps.push(Date.now() - start)),
      gate.wait().then(() => stamps.push(Date.now() - start)),
    ])
    stamps.sort((a, b) => a - b)
    expect(stamps[1]).toBeGreaterThanOrEqual(20)
    expect(stamps[2]).toBeGreaterThanOrEqual(45)
  })

  test('abort during the delay rejects with the abort reason', async () => {
    const gate = new MinIntervalGate(10_000)
    await gate.wait()
    const controller = new AbortController()
    const pending = gate.wait(controller.signal)
    controller.abort()
    const err = await pending.catch((e) => e)
    expect(err).toBeDefined()
    expect((err as Error).name).toBe('AbortError')
  })

  test('a pre-aborted signal rejects without waiting', async () => {
    const gate = new MinIntervalGate(10_000)
    await gate.wait()
    const err = await gate.wait(AbortSignal.abort()).catch((e) => e)
    expect((err as Error).name).toBe('AbortError')
  })

  test('an aborted waiter gives its slot back to the next caller', async () => {
    const gate = new MinIntervalGate(200)
    await gate.wait()
    const controller = new AbortController()
    const aborted = gate.wait(controller.signal)
    controller.abort()
    await aborted.catch(() => {})
    const started = Date.now()
    await gate.wait()
    // the next caller takes the released slot (~200 ms), not the one after it (~400 ms)
    expect(Date.now() - started).toBeLessThan(300)
  })

  test('an aborted waiter keeps its slot when someone already queued behind it', async () => {
    const gate = new MinIntervalGate(60)
    await gate.wait()
    const controller = new AbortController()
    const first = gate.wait(controller.signal)
    const second = gate.wait()
    controller.abort()
    await first.catch(() => {})
    const started = Date.now()
    await second
    // second reserved slot 2 before the abort and still waits for it
    expect(Date.now() - started).toBeGreaterThanOrEqual(90)
  })
})

describe('sleep', () => {
  test('rejects immediately for a pre-aborted signal', async () => {
    const started = Date.now()
    const err = await sleep(5000, AbortSignal.abort()).catch((e) => e)
    expect((err as Error).name).toBe('AbortError')
    expect(Date.now() - started).toBeLessThan(50)
  })

  test('rejects when the signal aborts during the delay and resolves otherwise', async () => {
    const controller = new AbortController()
    const pending = sleep(5000, controller.signal)
    controller.abort(new Error('stop'))
    expect(((await pending.catch((e) => e)) as Error).message).toBe('stop')
    await sleep(1, new AbortController().signal)
  })
})
