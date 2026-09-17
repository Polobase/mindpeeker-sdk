import { describe, expect, test } from 'bun:test'
import { EntropyError } from '@mindpeeker/entropy'
import { NegentropyError } from '@mindpeeker/negentropy'
import {
  type HealthEvent,
  healthMonitored,
  healthNote,
  healthTestError,
  MAX_SILENT_HEALTH_FAILURES,
} from '../../src/demo/health.js'
import type { ByteProvider } from '../../src/sources.js'
import { prngBytes } from '../helpers/streams.js'

/** A scripted session: yield `chunks` chunks, then end or throw `error`. */
interface Session {
  readonly chunks: number
  readonly error?: unknown
}

function scripted(sessions: readonly Session[]): ByteProvider & { opened: () => number } {
  let opened = 0
  return {
    name: 'esp32(raw)',
    opened: () => opened,
    async *stream() {
      const session = sessions[opened++]
      if (!session) throw new Error('no more sessions scripted')
      for (let i = 0; i < session.chunks; i++) yield prngBytes(8, opened * 100 + i)
      if (session.error !== undefined) throw session.error
    },
  }
}

const alarm = (message = 'repetition count test failed: 5 identical samples (cutoff 5)') =>
  new EntropyError('health_test', message, { provider: 'esp32(raw)' })

async function drain(provider: ByteProvider, signal?: AbortSignal): Promise<number> {
  let chunks = 0
  for await (const _chunk of provider.stream({ chunkBytes: 8, ...(signal && { signal }) })) {
    chunks++
  }
  return chunks
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('expected a rejection')
}

describe('healthMonitored', () => {
  test('a health_test failure is reported and the session restarted; output continues', async () => {
    const provider = scripted([{ chunks: 2, error: alarm() }, { chunks: 3 }])
    const events: HealthEvent[] = []
    const chunks = await drain(healthMonitored(provider, (event) => events.push(event)))
    expect(chunks).toBe(5)
    expect(provider.opened()).toBe(2)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ source: 'esp32(raw)', failures: 1, restarted: true })
    expect(events[0]?.error.code).toBe('health_test')
  })

  test('failures after output keep restarting; silent failures in a row give up', async () => {
    const provider = scripted([
      { chunks: 1, error: alarm() },
      { chunks: 1, error: alarm() },
      ...Array.from({ length: MAX_SILENT_HEALTH_FAILURES }, () => ({ chunks: 0, error: alarm() })),
    ])
    const events: HealthEvent[] = []
    const error = await rejection(drain(healthMonitored(provider, (e) => events.push(e))))
    expect((error as EntropyError).code).toBe('health_test')
    expect(events.map((e) => [e.failures, e.restarted])).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [4, true],
      [5, false],
    ])
    expect(provider.opened()).toBe(5)
  })

  test('a wrapped health_test (e.g. inside a source_failed) counts; other errors propagate at once', async () => {
    const wrapped = new NegentropyError('source_failed', 'trial source failed', { cause: alarm() })
    expect(healthTestError(wrapped)?.code).toBe('health_test')
    expect(healthTestError(new EntropyError('network', 'ENOENT'))).toBeUndefined()
    expect(healthTestError('health_test')).toBeUndefined()

    const unplugged = new EntropyError('network', 'opening /dev/ttyUSB0 failed: ENOENT')
    const provider = scripted([{ chunks: 1, error: unplugged }])
    const events: HealthEvent[] = []
    expect(await rejection(drain(healthMonitored(provider, (e) => events.push(e))))).toBe(unplugged)
    expect(events).toEqual([])
    expect(provider.opened()).toBe(1)
  })

  test('after an abort nothing restarts, and a throwing hook is ignored', async () => {
    const controller = new AbortController()
    controller.abort()
    const failure = alarm()
    const aborted = scripted([{ chunks: 0, error: failure }])
    const events: HealthEvent[] = []
    const error = await rejection(
      drain(
        healthMonitored(aborted, (e) => events.push(e)),
        controller.signal,
      ),
    )
    expect(error).toBe(failure)
    expect(events).toEqual([])

    const hooked = scripted([{ chunks: 1, error: alarm() }, { chunks: 1 }])
    const chunks = await drain(
      healthMonitored(hooked, () => {
        throw new Error('hook exploded')
      }),
    )
    expect(chunks).toBe(2)
  })
})

describe('healthNote', () => {
  test('states the tests, the failure count, the outcome and the reason', () => {
    expect(healthNote()).toBe('SP 800-90B health tests: no failures')
    const error = alarm('adaptive proportion test failed')
    expect(healthNote({ source: 'x', failures: 1, restarted: true, error })).toBe(
      'health_test: 1 failure, session restarted — adaptive proportion test failed',
    )
    expect(healthNote({ source: 'x', failures: 4, restarted: false, error })).toBe(
      'health_test: 4 failures, giving up — adaptive proportion test failed',
    )
  })
})
