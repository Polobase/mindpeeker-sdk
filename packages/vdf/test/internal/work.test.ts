import { describe, expect, test } from 'bun:test'
import { VdfError } from '../../src/errors.js'
import {
  PROGRESS_INTERVAL,
  Work,
  YIELD_INTERVAL,
  yieldToEventLoop,
} from '../../src/internal/work.js'

describe('yieldToEventLoop', () => {
  test('lets a pending timer fire while a busy loop keeps yielding', async () => {
    let fired = false
    setTimeout(() => {
      fired = true
    }, 2)
    const started = performance.now()
    while (!fired && performance.now() - started < 1000) {
      const spin = performance.now()
      while (performance.now() - spin < 1) {
        // busy work between yields
      }
      await yieldToEventLoop()
    }
    expect(fired).toBe(true)
  })
})

describe('Work', () => {
  test('reports about every PROGRESS_INTERVAL units and exactly once at completion', async () => {
    const calls: [number, number][] = []
    const work = new Work(3000, undefined, (d, t) => calls.push([d, t]))
    for (let i = 0; i < 30; i++) await work.advance(100)
    work.finish()
    expect(calls).toEqual([
      [1100, 3000],
      [2200, 3000],
      [3000, 3000],
    ])
    expect(PROGRESS_INTERVAL).toBe(1024)
    expect(YIELD_INTERVAL).toBe(16 * 1024)
  })

  test('finish emits (total, total) only when it was not reported yet', () => {
    const calls: [number, number][] = []
    new Work(0, undefined, (d, t) => calls.push([d, t])).finish()
    expect(calls).toEqual([[0, 0]])
  })

  test('abort surfaces as VdfError(aborted) carrying the signal reason', async () => {
    const controller = new AbortController()
    const work = new Work(10_000, controller.signal)
    await work.advance(10)
    controller.abort(new Error('user cancelled'))
    let caught: unknown
    try {
      await work.advance(10)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(VdfError)
    expect((caught as VdfError).code).toBe('aborted')
    expect(((caught as VdfError).cause as Error).message).toBe('user cancelled')
    expect(work.done).toBe(20)
  })
})
