import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import {
  DEFAULT_QUEUE_LIMIT,
  DropOldestQueue,
  permissionError,
  STARVATION_YIELD_EVERY,
  starvationGuard,
} from '../../src/internal/queue.js'

describe('DropOldestQueue', () => {
  test('defaults to 8 and validates the limit', () => {
    expect(new DropOldestQueue().limit).toBe(DEFAULT_QUEUE_LIMIT)
    expect(DEFAULT_QUEUE_LIMIT).toBe(8)
    expect(() => new DropOldestQueue(0)).toThrow(EntropyError)
    expect(() => new DropOldestQueue(1.5)).toThrow(EntropyError)
  })

  test('drops the oldest items beyond the limit and counts them', async () => {
    const queue = new DropOldestQueue<number>(3)
    for (let i = 1; i <= 10; i++) queue.push(i)
    expect(queue.size).toBe(3)
    expect(queue.dropped).toBe(7)
    expect([await queue.take(), await queue.take(), await queue.take()]).toEqual([8, 9, 10])
  })

  test('take() waits for the next push', async () => {
    const queue = new DropOldestQueue<string>(2)
    const pending = queue.take()
    setTimeout(() => queue.push('late'), 5)
    expect(await pending).toBe('late')
  })

  test('take() rejects when the signal aborts while waiting', async () => {
    const queue = new DropOldestQueue<string>(2)
    const controller = new AbortController()
    const pending = queue.take(controller.signal)
    controller.abort(new Error('stop'))
    expect(((await pending.catch((e) => e)) as Error).message).toBe('stop')
    queue.push('after') // no dangling waiter
    expect(await queue.take()).toBe('after')
  })
})

describe('starvationGuard', () => {
  test('yields a macrotask after the configured run of product-less iterations', async () => {
    const tick = starvationGuard()
    let timerFired = false
    setTimeout(() => {
      timerFired = true
    }, 0)
    for (let i = 0; i < STARVATION_YIELD_EVERY - 1; i++) await tick(false)
    expect(timerFired).toBe(false) // microtasks only so far
    await tick(false)
    expect(timerFired).toBe(true)
  })

  test('productive iterations reset the count', async () => {
    const tick = starvationGuard()
    let timerFired = false
    setTimeout(() => {
      timerFired = true
    }, 0)
    for (let i = 0; i < STARVATION_YIELD_EVERY * 3; i++) await tick(i % 10 === 0)
    expect(timerFired).toBe(false)
  })

  test('observes an abort at the macrotask boundary', async () => {
    const controller = new AbortController()
    const tick = starvationGuard(controller.signal)
    controller.abort(new Error('aborted'))
    let err: unknown
    try {
      for (let i = 0; i < STARVATION_YIELD_EVERY; i++) await tick(false)
    } catch (e) {
      err = e
    }
    expect((err as Error).message).toBe('aborted')
  })
})

describe('permissionError', () => {
  test('maps NotAllowedError/SecurityError to permission and passes others through', () => {
    const denied = new DOMException('denied', 'NotAllowedError')
    const mapped = permissionError(denied, 'camera', 'camera') as EntropyError
    expect(mapped.code).toBe('permission')
    expect(mapped.cause).toBe(denied)
    expect(
      (permissionError(new DOMException('x', 'SecurityError'), 'p', 'x') as EntropyError).code,
    ).toBe('permission')
    const other = new DOMException('gone', 'NotFoundError')
    expect(permissionError(other, 'camera', 'camera')).toBe(other)
  })
})
