import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { resolveWindow } from '../../src/experiment/windows.js'

const timeline = Float64Array.from({ length: 10 }, (_, t) => 1000 + t * 100) // 1000 … 1900

describe('resolveWindow', () => {
  test('index windows: closed inside the data, clipped and open past it', () => {
    const spec = { id: 'e', statistic: 'netvar' as const, start: 2, end: 8 }
    expect(resolveWindow(spec, 10, undefined)).toEqual({ start: 2, end: 8, closed: true })
    const open = resolveWindow({ ...spec, end: 12 }, 10, undefined)
    expect(open).toMatchObject({ start: 2, end: 10, closed: false })
    expect(open.reason).toContain('extends past the 10 recorded steps')
    expect(resolveWindow({ ...spec, start: 15, end: 20 }, 10, undefined)).toMatchObject({
      start: 10,
      end: 10,
      closed: false,
    })
  })

  test('Date windows close only once a step is stamped at or after the end', () => {
    const at = (ms: number) => new Date(ms)
    const spec = { id: 'd', statistic: 'netvar' as const, start: at(1250), end: at(1500) }
    expect(resolveWindow(spec, 10, timeline)).toEqual({ start: 3, end: 5, closed: true })
    // ends exactly after the last step: not provably closed
    const open = resolveWindow({ ...spec, end: at(1950) }, 10, timeline)
    expect(open).toMatchObject({ start: 3, end: 10, closed: false })
    // closed but no step inside
    const empty = resolveWindow({ ...spec, start: at(1210), end: at(1290) }, 10, timeline)
    expect(empty).toMatchObject({ start: 3, end: 3, closed: true })
    expect(empty.reason).toContain('no recorded step')
    expect(() => resolveWindow(spec, 10, undefined)).toThrow(NegentropyError)
  })
})
