import { describe, expect, test } from 'bun:test'
import { appendEntry, startChain } from '../src/chain.js'
import {
  checkpointOf,
  checkpointText,
  parseCheckpoint,
  serializeCheckpoint,
  verifyCheckpoint,
} from '../src/checkpoint.js'
import { merkleTree } from '../src/merkle.js'
import { verifyConsistency, verifyInclusion } from '../src/merkle-verify.js'
import { ed25519VerifierKey, signNote } from '../src/note.js'
import { b64, fixture } from './helpers/fixtures.js'

interface NotesFixture {
  sumdb: { checkpoint: string; key: string; captured: string }
  c2sp: { key: string }
}
const fx = fixture<NotesFixture>('notes.json')
const EM = String.fromCodePoint(0x2014)
const invalidNote = expect.objectContaining({ code: 'invalid_note' })

describe('C2SP tlog-checkpoint text', () => {
  test('parses the live sum.golang.org checkpoint and re-serializes it byte-for-byte', () => {
    const cp = parseCheckpoint(fx.sumdb.checkpoint)
    expect(cp.origin).toBe('go.sum database tree')
    expect(cp.size).toBe(63_570_315)
    expect(cp.root).toEqual(b64('Oa4zLf66dXzZgbR+qL05aDrDMhePwydC3HqpTx4Mt+k='))
    expect(cp.extensions).toEqual([])
    expect(cp.signatures.map((s) => s.name)).toEqual(['sum.golang.org'])
    expect(serializeCheckpoint(cp, cp.signatures)).toBe(fx.sumdb.checkpoint)
    expect(checkpointText(cp)).toBe(cp.text)
  })

  test('a bare body parses with no signatures; extension lines are kept', () => {
    const body = `example.com/log\n0\n${'A'.repeat(43)}=\next one\n`
    const cp = parseCheckpoint(body)
    expect(cp).toMatchObject({ origin: 'example.com/log', size: 0, extensions: ['ext one'] })
    expect(cp.signatures).toEqual([])
    expect(serializeCheckpoint(cp)).toBe(body)
  })

  test('rejects malformed checkpoints', () => {
    const root = `${'A'.repeat(43)}=`
    const bad = [
      `origin\n12\n`, // too few lines
      `origin\n012\n${root}\n`, // leading zero
      `origin\n-1\n${root}\n`,
      `origin\n1e3\n${root}\n`,
      `origin\n9007199254740993\n${root}\n`, // above 2^53
      `origin\n1\n${'A'.repeat(42)}==\n`, // 31 bytes
      `origin\n1\n${root}`, // no final newline
      `\n1\n${root}\n`, // empty origin
      `origin\n1\n${root}\n\n${EM} x AAAA\n`, // signature too short
    ]
    for (const text of bad) expect(() => parseCheckpoint(text), text).toThrow(invalidNote)
  })

  test('checkpointText validates fields', () => {
    const root = new Uint8Array(32)
    const ok = { origin: 'o', size: 1, root, extensions: [] }
    expect(checkpointText(ok)).toBe(`o\n1\n${'A'.repeat(43)}=\n`)
    for (const bad of [
      { ...ok, origin: '' },
      { ...ok, origin: 'a\nb' },
      { ...ok, size: -1 },
      { ...ok, size: 1.5 },
      { ...ok, root: new Uint8Array(31) },
      { ...ok, extensions: [''] },
      { ...ok, origin: `o${String.fromCharCode(13)}` },
    ]) {
      expect(() => checkpointText(bad)).toThrow(invalidNote)
    }
  })
})

describe('verifyCheckpoint', () => {
  test(`the sum.golang.org checkpoint captured ${fx.sumdb.captured} verifies with the Go key`, async () => {
    const result = await verifyCheckpoint(fx.sumdb.checkpoint, [fx.sumdb.key], {
      origin: 'go.sum database tree',
    })
    expect(result.status).toBe('verified')
    expect(result.checkpoint?.size).toBe(63_570_315)
  })

  test('an altered tree size fails; a wrong origin fails; unknown keys leave it unverified', async () => {
    const altered = fx.sumdb.checkpoint.replace('63570315', '63570316')
    expect((await verifyCheckpoint(altered, [fx.sumdb.key])).status).toBe('failed')
    const wrongOrigin = await verifyCheckpoint(fx.sumdb.checkpoint, [fx.sumdb.key], {
      origin: 'example.com/other',
    })
    expect(wrongOrigin).toMatchObject({ status: 'failed' })
    expect(wrongOrigin.verified.length).toBe(1)
    expect((await verifyCheckpoint(fx.sumdb.checkpoint, [fx.c2sp.key])).status).toBe('unverified')
  })

  test('unparseable text is a failed result, not a throw', async () => {
    const result = await verifyCheckpoint('not a checkpoint', [fx.sumdb.key])
    expect(result.status).toBe('failed')
    expect(result.checkpoint).toBeUndefined()
  })

  test('an unsigned body is unverified', async () => {
    const body = `example.com/log\n0\n${'A'.repeat(43)}=\n`
    expect((await verifyCheckpoint(body, [fx.sumdb.key])).status).toBe('unverified')
  })
})

describe('publishing a ledger chain as a signed checkpoint', () => {
  test('chain lines -> Merkle checkpoint -> Ed25519 note -> inclusion and consistency checks', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair
    const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    const signer = { name: 'example.org/experiment-log', privateKey: pair.privateKey, publicKey }
    const vkey = await ed25519VerifierKey(signer.name, publicKey)

    let chain = startChain()
    const lines: string[] = []
    for (let i = 0; i < 11; i++) {
      const result = await appendEntry(chain, { trial: i, bits: 200, sum: 100 + (i % 7) })
      lines.push(result.line)
      chain = result.chain
    }

    const early = await checkpointOf(signer.name, lines.slice(0, 6))
    const late = await checkpointOf(signer.name, lines)
    const text = checkpointText(late)
    const published = serializeCheckpoint(late, [await signNote(text, signer)])

    const verified = await verifyCheckpoint(published, [vkey], { origin: signer.name })
    expect(verified.status).toBe('verified')
    const cp = verified.checkpoint as NonNullable<typeof verified.checkpoint>

    const tree = await merkleTree(lines)
    expect(cp.root).toEqual(tree.root)
    expect(
      await verifyInclusion(lines[4] as string, 4, cp.size, tree.inclusionProof(4), cp.root),
    ).toBe(true)
    expect(
      await verifyConsistency(early.size, cp.size, early.root, cp.root, tree.consistencyProof(6)),
    ).toBe(true)
  })
})
