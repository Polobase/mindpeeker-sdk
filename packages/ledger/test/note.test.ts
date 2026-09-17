import { describe, expect, test } from 'bun:test'
import {
  ed25519VerifierKey,
  noteKeyId,
  parseSignedNote,
  parseVerifierKey,
  serializeSignedNote,
  signNote,
  verifyNote,
} from '../src/note.js'
import { fixture, flip } from './helpers/fixtures.js'

interface NotesFixture {
  go: { text: string; note: string; keys: { peter: string; enoch: string } }
  c2sp: { note: string; key: string }
}
const fx = fixture<NotesFixture>('notes.json')
const EM = String.fromCodePoint(0x2014)
const invalidNote = expect.objectContaining({ code: 'invalid_note' })

async function ed25519Signer(name: string) {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  return { name, privateKey: pair.privateKey, publicKey }
}

describe('signed-note parsing', () => {
  test('Go sumdb/note vector: text up to the last blank line, two signatures', () => {
    const note = parseSignedNote(fx.go.note)
    expect(note.text).toBe(fx.go.text)
    expect(note.signatures.map((s) => [s.name, s.keyId, s.signature.length])).toEqual([
      ['PeterNeumann', 0xc74f20a3, 64],
      ['EnochRoot', 0xaf0cfe78, 64],
    ])
    expect(serializeSignedNote(note)).toBe(fx.go.note)
  })

  test('text may contain blank lines; the last one separates the signatures', () => {
    const c2sp = parseSignedNote(fx.c2sp.note)
    const text = `para one\n\npara two\n`
    const message = `${text}\n${serializeSignedNote(c2sp).slice(c2sp.text.length + 1)}`
    expect(parseSignedNote(message).text).toBe(text)
  })

  test('rejects malformed notes', () => {
    const sig = fx.c2sp.note.slice(fx.c2sp.note.indexOf(EM))
    const bad = [
      'no signatures at all\n',
      `text\n\n`,
      `text\n\n${sig.trimEnd()}`, // no final newline
      `text\n\n- example.com/foo AAAAAAAA\n`, // hyphen, not em dash
      `text\n\n${EM} example.com/foo\n`, // no signature
      `text\n\n${EM} bad+name AAAAAAAA\n`,
      `text\n\n${EM} name AAAA\n`, // fewer than 5 bytes
      `text\n\n${EM} name AAAAAAA=x\n`, // not base64
      `te${String.fromCharCode(9)}xt\n\n${sig}`, // control character
      `te${String.fromCharCode(0xd800)}xt\n\n${sig}`, // lone surrogate
      `text\n\n${sig.repeat(101)}`,
    ]
    for (const message of bad) expect(() => parseSignedNote(message), message).toThrow(invalidNote)
  })

  test('serialization validates its input', () => {
    const { signatures } = parseSignedNote(fx.c2sp.note)
    expect(() => serializeSignedNote({ text: 'no newline', signatures })).toThrow(invalidNote)
    expect(() => serializeSignedNote({ text: 'x\n', signatures: [] })).toThrow(invalidNote)
    const sig = signatures[0] as (typeof signatures)[0]
    expect(() =>
      serializeSignedNote({ text: 'x\n', signatures: [{ ...sig, name: 'a b' }] }),
    ).toThrow(invalidNote)
    expect(() =>
      serializeSignedNote({ text: 'x\n', signatures: [{ ...sig, keyId: 2 ** 32 }] }),
    ).toThrow(invalidNote)
  })
})

describe('verifier keys', () => {
  test('parses the published vkeys and checks the Ed25519 key id', async () => {
    const peter = await parseVerifierKey(fx.go.keys.peter)
    expect(peter).toMatchObject({ name: 'PeterNeumann', keyId: 0xc74f20a3, type: 1 })
    expect(peter.publicKey.length).toBe(32)
    expect(await noteKeyId(peter.name, 1, peter.publicKey)).toBe(0xc74f20a3)
    expect(await ed25519VerifierKey(peter.name, peter.publicKey)).toBe(fx.go.keys.peter)
  })

  test('rejects malformed keys (the Go note_test.go bad-key cases)', async () => {
    const bad = [
      'PeterNeumann+cc469956+ARpc2QcUPDhMQegwxbzhKqiBfsVkmqq/LDE4izWy10TWBADKEY==', // wrong length
      'PeterNeumann+c74f20a4+ARpc2QcUPDhMQegwxbzhKqiBfsVkmqq/LDE4izWy10TW', // id mismatch
      'PeterNeumann+C74F20A3+ARpc2QcUPDhMQegwxbzhKqiBfsVkmqq/LDE4izWy10TW', // upper-case id
      'Peter Neumann+c74f20a3+ARpc2QcUPDhMQegwxbzhKqiBfsVkmqq/LDE4izWy10TW',
      'PeterNeumann+c74f20a3',
      'PeterNeumann+c74f20a3+!!!!',
    ]
    for (const vkey of bad) await expect(parseVerifierKey(vkey)).rejects.toMatchObject(invalidNote)
  })

  test('an unknown algorithm parses but is never verified', async () => {
    // Go's "unknown algorithm, with adjusted key hash" vector (type byte 0x65)
    const key = await parseVerifierKey(
      'PeterNeumann+173116ae+ZRpc2QcUPDhMQegwxbzhKqiBfsVkmqq/LDE4izWy10TW',
    )
    expect(key.type).toBe(0x65)
  })
})

describe('verifyNote', () => {
  test('both Go signatures verify with both keys', async () => {
    const result = await verifyNote(fx.go.note, [fx.go.keys.peter, fx.go.keys.enoch])
    expect(result.status).toBe('verified')
    expect(result.verified.map((s) => s.name)).toEqual(['PeterNeumann', 'EnochRoot'])
  })

  test('an unknown signer is ignored; one known signer suffices', async () => {
    const result = await verifyNote(fx.go.note, [fx.go.keys.peter])
    expect(result.status).toBe('verified')
    expect(result.unknown.map((s) => s.name)).toEqual(['EnochRoot'])
  })

  test('the c2sp.org/signed-note example verifies', async () => {
    expect((await verifyNote(fx.c2sp.note, [fx.c2sp.key])).status).toBe('verified')
  })

  test('no known key: unverified; an altered text: failed', async () => {
    expect((await verifyNote(fx.go.note, [fx.c2sp.key])).status).toBe('unverified')
    const altered = fx.go.note.replace('answer', 'Answer')
    const result = await verifyNote(altered, [fx.go.keys.peter, fx.go.keys.enoch])
    expect(result.status).toBe('failed')
    expect(result.failed.length).toBe(2)
  })

  test('a known key with a bad signature fails even if another verifies', async () => {
    const note = parseSignedNote(fx.go.note)
    const forged = note.signatures.map((s, i) => {
      const signature = s.signature.slice()
      if (i === 1) flip(signature, 0)
      return { ...s, signature }
    })
    const result = await verifyNote({ text: note.text, signatures: forged }, [
      fx.go.keys.peter,
      fx.go.keys.enoch,
    ])
    expect(result.status).toBe('failed')
    expect(result.verified.length).toBe(1)
  })

  test('sign, serialize, parse, verify round trip', async () => {
    const signer = await ed25519Signer('example.org/ledger')
    const vkey = await ed25519VerifierKey(signer.name, signer.publicKey)
    const text = 'head 2a\nsize 17\n'
    const message = serializeSignedNote({ text, signatures: [await signNote(text, signer)] })
    expect((await verifyNote(message, [vkey])).status).toBe('verified')
    // Ed25519 is deterministic: signing twice gives the same bytes
    expect((await signNote(text, signer)).signature).toEqual(
      parseSignedNote(message).signatures[0]?.signature as Uint8Array,
    )
  })

  test('a runtime without Ed25519 reports unverified, never verified', async () => {
    const subtle = {
      importKey: async () => {
        throw new DOMException('Ed25519 unsupported', 'NotSupportedError')
      },
    } as unknown as SubtleCrypto
    const result = await verifyNote(fx.c2sp.note, [fx.c2sp.key], { subtle })
    expect(result.status).toBe('unverified')
    expect(result.unsupported.length).toBe(1)
    expect(result.reason).toContain('cannot be checked')
  })

  test('duplicate keys are a caller error', async () => {
    await expect(verifyNote(fx.c2sp.note, [fx.c2sp.key, fx.c2sp.key])).rejects.toMatchObject({
      code: 'invalid_input',
    })
  })
})

describe('signNote key errors', () => {
  test('a non-Ed25519 key is invalid_input', async () => {
    const hmac = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    await expect(
      signNote('x\n', { name: 'n', privateKey: hmac, publicKey: new Uint8Array(32) }),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })

  test('a note object with a bad text is rejected before verification', async () => {
    await expect(verifyNote({ text: 'no newline', signatures: [] }, [])).rejects.toMatchObject({
      code: 'invalid_note',
    })
  })
})
