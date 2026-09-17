import { describe, expect, test } from 'bun:test'
import { verifyChain as psiVerifyChain } from '@mindpeeker/psi'
import { psiRecording, REGISTRATION } from '../scripts/fixtures/psi-recording.js'
import { appendEntry, startChain } from '../src/chain.js'
import { verifyChain } from '../src/chain-verify.js'
import { ZERO_HASH } from '../src/hash.js'
import { textFixture } from './helpers/fixtures.js'

/** Head of the psi fixture, computed independently with Python hashlib. */
const PSI_FIXTURE_HEAD = '667ce8e6e2178a939da7de2e76e68c97eacfb09d47f461502424bbeac5690bbb'

async function ledgerLines(n: number, genesis = ZERO_HASH): Promise<string[]> {
  let chain = startChain(genesis)
  const lines: string[] = []
  for (let i = 0; i < n; i++) {
    const result = await appendEntry(chain, { trial: i, sum: (i * 37) % 201 })
    lines.push(result.line)
    chain = result.chain
  }
  return lines
}

function edit(lines: string[], index: number, from: string, to: string): string[] {
  const copy = [...lines]
  copy[index] = (copy[index] as string).replace(from, to)
  return copy
}

describe('verifyChain on ledger chains', () => {
  test('accepts appendEntry output in every format mode; returns head and continuation', async () => {
    const lines = await ledgerLines(6)
    let chain = startChain()
    for (const line of lines) chain = (await appendEntry(chain, JSON.parse(line).record)).chain
    for (const format of ['auto', 'ledger'] as const) {
      const result = await verifyChain(lines, { format })
      expect(result).toEqual({ ok: true, lines: 6, entries: 6, head: chain.head, chain })
    }
    const next = await appendEntry((await verifyChain(lines)).chain as never, { trial: 6 })
    expect((await verifyChain([...lines, next.line], { head: next.chain.head })).ok).toBe(true)
  })

  test('input forms: whole text with CRLF and blank lines, arrays, async iterables', async () => {
    const lines = await ledgerLines(4)
    const expected = await verifyChain(lines)
    expect(await verifyChain(`${lines.join('\r\n')}\r\n\n`)).toEqual(expected)
    expect(
      await verifyChain([`${lines[0]}\n${lines[1]}\n`, lines[2] as string, `${lines[3]}\n`]),
    ).toEqual(expected)
    async function* stream() {
      for (const line of lines) yield `${line}\n`
    }
    expect(await verifyChain(stream())).toEqual(expected)
  })

  test('a custom genesis must be supplied to verify', async () => {
    const g = 'cd'.repeat(32)
    const lines = await ledgerLines(3, g)
    expect(await verifyChain(lines)).toMatchObject({ ok: false, brokenAt: 0, failure: 'bad_prev' })
    expect((await verifyChain(lines, { genesis: g })).chain?.genesis).toBe(g)
  })

  test('detects edits, deletions, insertions and reordering at the first affected line', async () => {
    const lines = await ledgerLines(8)
    const edited = edit(lines, 3, '"trial":3', '"trial":33')
    expect(await verifyChain(edited)).toMatchObject({ ok: false, brokenAt: 4, failure: 'bad_prev' })
    const deleted = lines.filter((_, i) => i !== 2)
    expect(await verifyChain(deleted)).toMatchObject({
      ok: false,
      brokenAt: 2,
      failure: 'bad_index',
    })
    const swapped = [...lines]
    ;[swapped[4], swapped[5]] = [swapped[5] as string, swapped[4] as string]
    expect(await verifyChain(swapped)).toMatchObject({
      ok: false,
      brokenAt: 4,
      failure: 'bad_index',
    })
    const inserted = [...lines.slice(0, 5), lines[4] as string, ...lines.slice(5)]
    expect((await verifyChain(inserted)).ok).toBe(false)
  })

  test('truncation passes without a head and fails against the published head', async () => {
    const lines = await ledgerLines(5)
    const { head } = await verifyChain(lines)
    const truncated = lines.slice(0, 4)
    expect((await verifyChain(truncated)).ok).toBe(true)
    expect(await verifyChain(truncated, { head })).toMatchObject({
      ok: false,
      failure: 'head_mismatch',
      brokenAt: 4,
      entries: 4,
    })
  })

  test('ledger format demands canonical entries; auto only the links', async () => {
    const lines = await ledgerLines(2)
    const spaced = [lines[0]?.replace('{"i":0,', '{"i": 0,') as string]
    expect(await verifyChain(spaced, { format: 'ledger' })).toMatchObject({
      ok: false,
      failure: 'not_canonical',
      brokenAt: 0,
    })
    expect((await verifyChain(spaced)).ok).toBe(true)
  })

  test('reports empty input, invalid JSON, non-objects and missing links', async () => {
    const lines = await ledgerLines(2)
    expect(await verifyChain('\n  \n')).toMatchObject({ ok: false, failure: 'empty', lines: 0 })
    expect(await verifyChain([lines[0] as string, '{oops'])).toMatchObject({
      failure: 'not_json',
      brokenAt: 1,
    })
    expect(await verifyChain([lines[0] as string, '[]'])).toMatchObject({
      failure: 'not_object',
      brokenAt: 1,
    })
    expect(await verifyChain([lines[0] as string, '{"i":1}'])).toMatchObject({
      failure: 'missing_link',
      brokenAt: 1,
    })
  })

  test('throws invalid_input only for bad options or input types', async () => {
    const invalid = { code: 'invalid_input' }
    await expect(verifyChain([], { format: 'x' as never })).rejects.toMatchObject(invalid)
    await expect(verifyChain([], { genesis: 'zz' })).rejects.toMatchObject(invalid)
    await expect(verifyChain([], { head: 'AB'.repeat(32) })).rejects.toMatchObject(invalid)
    await expect(verifyChain(42 as never)).rejects.toMatchObject(invalid)
    await expect(verifyChain([1] as never)).rejects.toMatchObject(invalid)
  })
})

describe('verifyChain on @mindpeeker/psi JSONL schema v2 recordings', () => {
  const fixtureText = textFixture('psi-v2-recording.jsonl')

  test('the checked-in fixture verifies byte-for-byte to the independently computed head', async () => {
    for (const format of ['auto', 'psi'] as const) {
      expect(await verifyChain(fixtureText, { format, genesis: REGISTRATION })).toEqual({
        ok: true,
        lines: 17,
        entries: 16,
        head: PSI_FIXTURE_HEAD,
      })
    }
  })

  test('the fixture is what psi records today, and both verifiers agree on the head', async () => {
    const lines = await psiRecording()
    expect(`${lines.join('\n')}\n`).toBe(fixtureText)
    const ours = await verifyChain(lines, { format: 'psi' })
    const theirs = await psiVerifyChain(lines, { registration: REGISTRATION })
    expect(theirs.ok).toBe(true)
    expect(ours.head).toBe(theirs.head as string)
  })

  test('tampering is found at the same line psi reports', async () => {
    const lines = fixtureText.trimEnd().split('\n')
    // a still-valid record (psi's own field checks pass), so only the hash link breaks
    const tampered = edit(lines, 5, '"arm":"experimental"', '"arm":"control"')
    const ours = await verifyChain(tampered, { format: 'psi' })
    const theirs = await psiVerifyChain(tampered)
    expect(ours).toMatchObject({ ok: false, brokenAt: 6, failure: 'bad_prev' })
    expect(theirs.brokenAt).toBe(6)
  })

  test('psi format checks the header: kind, genesis and registration binding', async () => {
    const lines = fixtureText.trimEnd().split('\n')
    expect(await verifyChain(lines.slice(1), { format: 'psi' })).toMatchObject({
      ok: false,
      failure: 'bad_header',
    })
    const wrongGenesis = edit(lines, 0, `"genesis":"${REGISTRATION}"`, `"genesis":"${ZERO_HASH}"`)
    expect(await verifyChain(wrongGenesis, { format: 'psi' })).toMatchObject({
      failure: 'bad_header',
    })
    expect(await verifyChain(lines, { format: 'psi', genesis: 'ee'.repeat(32) })).toMatchObject({
      failure: 'bad_header',
      brokenAt: 0,
    })
  })

  test('psi format rejects a non-trial line after the header', async () => {
    const lines = fixtureText.trimEnd().split('\n')
    const ledgerLine = (await ledgerLines(1))[0] as string
    expect(await verifyChain([lines[0] as string, ledgerLine], { format: 'psi' })).toMatchObject({
      ok: false,
      failure: 'bad_record',
      brokenAt: 1,
    })
  })

  test('ledger format rejects a psi recording', async () => {
    expect(await verifyChain(fixtureText, { format: 'ledger' })).toMatchObject({
      ok: false,
      failure: 'not_canonical',
      brokenAt: 0,
    })
  })
})
