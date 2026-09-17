import { describe, expect, test } from 'bun:test'
import { planDirectory, type SlotIdentity } from '../../client/directory.js'
import type { ChannelInfo } from '../../src/types.js'

const info = (id: number, name: string, kind: ChannelInfo['kind'] = 'series'): ChannelInfo => ({
  id,
  name,
  kind,
  status: 'live',
})

describe('planDirectory', () => {
  test('first directory: every entry is created, columns fit the count', () => {
    const plan = planDirectory(new Map(), [info(0, 'a'), info(1, 'b'), info(2, 'c')])
    expect(plan.remove).toEqual([])
    expect(plan.entries.map((e) => [e.info.id, e.create])).toEqual([
      [0, true],
      [1, true],
      [2, true],
    ])
    expect(plan.columns).toBe(2)
  })

  test('a reconnect with the same channels reuses every panel', () => {
    const mounted = new Map<number, SlotIdentity>([
      [0, { name: 'a', kind: 'bytes' }],
      [1, { name: 'b', kind: 'series' }],
    ])
    const plan = planDirectory(mounted, [
      info(0, 'a', 'bytes'),
      { ...info(1, 'b'), status: 'error' },
    ])
    expect(plan.remove).toEqual([])
    expect(plan.entries.every((e) => !e.create)).toBe(true)
    expect(plan.entries[1]?.info.status).toBe('error')
  })

  test('vanished channels and ids whose name or kind changed are replaced', () => {
    const mounted = new Map<number, SlotIdentity>([
      [0, { name: 'a', kind: 'bytes' }],
      [1, { name: 'b', kind: 'series' }],
      [2, { name: 'c', kind: 'matrix' }],
    ])
    const plan = planDirectory(mounted, [
      info(0, 'a', 'bytes'),
      info(1, 'renamed'),
      info(2, 'c', 'series'),
    ])
    expect([...plan.remove].sort()).toEqual([1, 2])
    expect(plan.entries.map((e) => e.create)).toEqual([false, true, true])
    expect([...planDirectory(mounted, []).remove].sort()).toEqual([0, 1, 2])
    expect(planDirectory(mounted, []).columns).toBe(1)
  })

  test('a repeated id keeps its first position with the last entry', () => {
    const plan = planDirectory(new Map(), [info(3, 'first'), info(4, 'x'), info(3, 'last')])
    expect(plan.entries.map((e) => e.info.name)).toEqual(['last', 'x'])
  })

  test('the container width caps the columns before panels are created', () => {
    const channels = [0, 1, 2, 3, 4].map((id) => info(id, `c${id}`))
    expect(planDirectory(new Map(), channels, 1400).columns).toBe(3)
    expect(planDirectory(new Map(), channels, 390).columns).toBe(1)
  })
})
