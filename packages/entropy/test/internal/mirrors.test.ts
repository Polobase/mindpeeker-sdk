import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { resolveBaseUrls, withMirrors } from '../../src/internal/mirrors.js'
import { thrownEntropyError } from '../helpers/errors.js'

describe('resolveBaseUrls', () => {
  const defaults = ['https://a.example', 'https://b.example']

  test('defaults, one baseUrl, or a mirror list', () => {
    expect(resolveBaseUrls({}, defaults, 'p')).toBe(defaults)
    expect(resolveBaseUrls({ baseUrl: 'https://proxy' }, defaults, 'p')).toEqual(['https://proxy'])
    expect(resolveBaseUrls({ baseUrls: ['https://x', 'https://y'] }, defaults, 'p')).toEqual([
      'https://x',
      'https://y',
    ])
  })

  test('rejects both at once, an empty list and empty entries', () => {
    for (const opts of [
      { baseUrl: 'https://x', baseUrls: ['https://y'] },
      { baseUrls: [] },
      { baseUrls: ['https://x', ''] },
      { baseUrl: '' },
      { baseUrls: 'https://x' as unknown as string[] },
    ]) {
      const err = thrownEntropyError(() => resolveBaseUrls(opts, defaults, 'p'), 'invalid_request')
      expect(err.provider).toBe('p')
    }
  })
})

describe('withMirrors', () => {
  test('tries the next mirror after an EntropyError and returns the first success', async () => {
    const tried: string[] = []
    const result = await withMirrors(['m1', 'm2', 'm3'], async (base) => {
      tried.push(base)
      if (base !== 'm3') throw new EntropyError('network', `${base} down`)
      return base
    })
    expect(result).toBe('m3')
    expect(tried).toEqual(['m1', 'm2', 'm3'])
  })

  test('rethrows the last error when every mirror fails', async () => {
    const err = await withMirrors(['m1', 'm2'], async (base) => {
      throw new EntropyError('bad_response', base)
    }).catch((e) => e)
    expect((err as EntropyError).message).toBe('m2')
  })

  test('stops at aborts, invalid_request and foreign errors', async () => {
    for (const error of [
      new DOMException('stop', 'AbortError'),
      new EntropyError('aborted', 'stop'),
      new EntropyError('invalid_request', 'bad'),
    ]) {
      let attempts = 0
      const caught = await withMirrors(['m1', 'm2'], async () => {
        attempts++
        throw error
      }).catch((e) => e)
      expect(caught).toBe(error)
      expect(attempts).toBe(1)
    }
  })
})
