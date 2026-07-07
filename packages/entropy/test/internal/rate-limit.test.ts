import { describe, expect, test } from 'bun:test'
import { MinIntervalGate } from '../../src/internal/rate-limit.js'

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
})
