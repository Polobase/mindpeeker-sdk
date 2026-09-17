import { describe, expect, test } from 'bun:test'
import { appendEntry, parseEntry, startChain } from '../src/chain.js'
import { ZERO_HASH } from '../src/hash.js'
import type { ChainHead } from '../src/types.js'
import { fixture } from './helpers/fixtures.js'

interface ChainKat {
  genesis: string
  records: unknown[]
  lines: string[]
  head: string
}
const kat = fixture<{ chains: ChainKat[] }>('records-kat.json')

const invalidInput = expect.objectContaining({ code: 'invalid_input' })
const invalidEntry = expect.objectContaining({ code: 'invalid_entry' })

describe('startChain', () => {
  test('defaults to 64 zeros; head = genesis, size 0', () => {
    expect(startChain()).toEqual({ genesis: ZERO_HASH, head: ZERO_HASH, size: 0 })
    const g = 'ab'.repeat(32)
    expect(startChain(g)).toEqual({ genesis: g, head: g, size: 0 })
    expect(Object.isFrozen(startChain())).toBe(true)
  })

  test('rejects a malformed genesis', () => {
    for (const bad of ['AB'.repeat(32), 'ab', 7]) {
      expect(() => startChain(bad as string)).toThrow(invalidInput)
    }
  })
})

describe('appendEntry (Python known answers)', () => {
  test.each(kat.chains.map((c, i) => [i, c] as const))('chain %i', async (_i, c) => {
    let chain = startChain(c.genesis)
    for (const [i, record] of c.records.entries()) {
      const result = await appendEntry(chain, record)
      expect(result.line).toBe(c.lines[i] as string)
      expect(result.entry).toEqual({ i, prev: chain.head, record } as never)
      expect(result.chain.size).toBe(i + 1)
      chain = result.chain
    }
    expect(chain.head).toBe(c.head)
    expect(chain.genesis).toBe(c.genesis)
  })

  test('the entry is a frozen copy of what was recorded', async () => {
    const record = { list: [1, 2], nested: { a: 1 } }
    const { entry } = await appendEntry(startChain(), record)
    record.list.push(3)
    expect(entry.record).toEqual({ list: [1, 2], nested: { a: 1 } })
    expect(Object.isFrozen(entry)).toBe(true)
    expect(Object.isFrozen((entry.record as { nested: object }).nested)).toBe(true)
  })

  test('non-canonical records are rejected with invalid_json', async () => {
    await expect(appendEntry(startChain(), { at: new Date(0) })).rejects.toMatchObject({
      code: 'invalid_json',
    })
    await expect(appendEntry(startChain(), undefined)).rejects.toMatchObject({
      code: 'invalid_json',
    })
  })

  test('malformed chain heads are rejected', async () => {
    const bad: unknown[] = [
      null,
      { genesis: ZERO_HASH, head: ZERO_HASH, size: -1 },
      { genesis: ZERO_HASH, head: ZERO_HASH, size: 1.5 },
      { genesis: ZERO_HASH, head: 'ff'.repeat(32), size: 0 },
      { genesis: 'x', head: ZERO_HASH, size: 0 },
      { genesis: ZERO_HASH, head: ZERO_HASH, size: Number.MAX_SAFE_INTEGER },
    ]
    for (const chain of bad) {
      await expect(appendEntry(chain as ChainHead, 1)).rejects.toMatchObject({
        code: 'invalid_input',
      })
    }
  })
})

describe('parseEntry', () => {
  test('round-trips every known-answer line', () => {
    for (const c of kat.chains) {
      for (const [i, line] of c.lines.entries()) {
        expect(parseEntry(line)).toEqual({
          i,
          prev: expect.any(String),
          record: c.records[i],
        } as never)
      }
    }
  })

  test('rejects non-canonical and malformed lines', () => {
    const prev = ZERO_HASH
    const bad = [
      'not json',
      '[1]',
      `{"prev":"${prev}","i":0,"record":1}`, // member order
      `{"i":0,"prev":"${prev}","record":1.0}`, // number form
      `{"i":0, "prev":"${prev}","record":1}`, // whitespace
      `{"i":0,"prev":"${prev}"}`, // missing record
      `{"extra":1,"i":0,"prev":"${prev}","record":1}`,
      `{"i":-1,"prev":"${prev}","record":1}`,
      `{"i":0.5,"prev":"${prev}","record":1}`,
      `{"i":0,"prev":"${'A'.repeat(64)}","record":1}`,
      `{"i":0,"prev":"${prev}","record":1e999}`,
    ]
    for (const line of bad) expect(() => parseEntry(line), line).toThrow(invalidEntry)
    expect(() => parseEntry(5 as unknown as string)).toThrow(invalidEntry)
  })
})
