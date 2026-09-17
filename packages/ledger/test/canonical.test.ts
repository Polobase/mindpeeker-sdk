import { describe, expect, test } from 'bun:test'
import { canonicalJson } from '@mindpeeker/negentropy'
import { canonicalBytes, canonicalize, MAX_JSON_DEPTH } from '../src/canonical.js'
import { fixture, hex } from './helpers/fixtures.js'

const invalidJson = expect.objectContaining({ code: 'invalid_json' })
const BS = String.fromCharCode(92)
/** A JSON `\uXXXX` escape as source text (built, so no literal escape sits in this file). */
const esc = (code: string) => `${BS}u${code}`

/** A double from its IEEE 754 big-endian hex (RFC 8785 Appendix B notation). */
function ieee(bits: string): number {
  const view = new DataView(new ArrayBuffer(8))
  view.setUint32(0, Number.parseInt(bits.slice(0, 8), 16))
  view.setUint32(4, Number.parseInt(bits.slice(8), 16))
  return view.getFloat64(0)
}

describe('RFC 8785 worked examples', () => {
  // §3.2.2 input, as JSON text (escapes are assembled below)
  const stringLiteral = `"${esc('20ac')}$${esc('000F')}${esc('000a')}A'${esc('0042')}${esc('0022')}${esc('005c')}${BS}${BS}${BS}"${BS}/"`
  const input = `{
    "numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],
    "string": ${stringLiteral},
    "literals": [null, true, false]
  }`

  test('§3.2.3/§3.2.4: canonical form as UTF-8 bytes', () => {
    const expected = hex(
      '7b226c69746572616c73223a5b6e756c6c2c747275652c66616c73655d2c226e756d62657273223a' +
        '5b3333333333333333332e333333333333332c31652b33302c342e352c302e3030322c31652d3237' +
        '5d2c22737472696e67223a22e282ac245c75303030665c6e4127425c225c5c5c5c5c222f227d',
    )
    expect(canonicalBytes(JSON.parse(input))).toEqual(expected)
  })

  test('§3.2.3: property sorting by UTF-16 code units', () => {
    const sortInput = `{
      "${esc('20ac')}": "Euro Sign",
      "${BS}r": "Carriage Return",
      "${esc('fb33')}": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "${esc('d83d')}${esc('de00')}": "Emoji: Grinning Face",
      "${esc('0080')}": "Control",
      "${esc('00f6')}": "Latin Small Letter O With Diaeresis"
    }`
    // Read values in serialized order (JSON.parse would move the integer-like key "1" first)
    const order = [...canonicalize(JSON.parse(sortInput)).matchAll(/":"([^"]*)"/g)].map((m) => m[1])
    expect(order).toEqual([
      'Carriage Return',
      'One',
      'Control',
      'Latin Small Letter O With Diaeresis',
      'Euro Sign',
      'Emoji: Grinning Face',
      'Hebrew Letter Dalet With Dagesh',
    ])
  })

  const appendixB: [string, string][] = [
    ['0000000000000000', '0'],
    ['8000000000000000', '0'],
    ['0000000000000001', '5e-324'],
    ['8000000000000001', '-5e-324'],
    ['7fefffffffffffff', '1.7976931348623157e+308'],
    ['ffefffffffffffff', '-1.7976931348623157e+308'],
    ['4340000000000000', '9007199254740992'],
    ['c340000000000000', '-9007199254740992'],
    ['4430000000000000', '295147905179352830000'],
    ['44b52d02c7e14af5', '9.999999999999997e+22'],
    ['44b52d02c7e14af6', '1e+23'],
    ['44b52d02c7e14af7', '1.0000000000000001e+23'],
    ['444b1ae4d6e2ef4e', '999999999999999700000'],
    ['444b1ae4d6e2ef4f', '999999999999999900000'],
    ['444b1ae4d6e2ef50', '1e+21'],
    ['3eb0c6f7a0b5ed8c', '9.999999999999997e-7'],
    ['3eb0c6f7a0b5ed8d', '0.000001'],
    ['41b3de4355555553', '333333333.3333332'],
    ['41b3de4355555554', '333333333.33333325'],
    ['41b3de4355555555', '333333333.3333333'],
    ['41b3de4355555556', '333333333.3333334'],
    ['41b3de4355555557', '333333333.33333343'],
    ['becbf647612f3696', '-0.0000033333333333333333'],
    ['43143ff3c1cb0959', '1424953923781206.2'],
  ]
  test.each(appendixB)('Appendix B: %s -> %s', (bits, expected) => {
    expect(canonicalize(ieee(bits))).toBe(expected)
  })

  test('Appendix B: NaN and Infinity are errors', () => {
    expect(() => canonicalize(ieee('7fffffffffffffff'))).toThrow(invalidJson)
    expect(() => canonicalize(ieee('7ff0000000000000'))).toThrow(invalidJson)
    expect(() => canonicalize(Number.NEGATIVE_INFINITY)).toThrow(invalidJson)
  })
})

describe('cyberphone/json-canonicalization test data (RFC 8785 Appendix I)', () => {
  const vectors = fixture<{ cases: { name: string; input: string; output: string }[] }>(
    'jcs-cyberphone.json',
  )
  test('all six reference files are present', () => {
    expect(vectors.cases.map((c) => c.name)).toEqual([
      'arrays',
      'french',
      'structures',
      'unicode',
      'values',
      'weird',
    ])
  })
  test.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(canonicalize(JSON.parse(c.input))).toBe(c.output)
  })
})

describe('rejections (I-JSON, no silent coercion)', () => {
  class Point {
    x = 1
  }
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  const holey: unknown[] = [1]
  holey[2] = 3
  const cases: [string, unknown][] = [
    ['undefined', undefined],
    ['undefined member', { a: undefined }],
    ['undefined element', [1, undefined]],
    ['array hole', holey],
    ['bigint', { n: 1n }],
    ['function', { f: () => 1 }],
    ['symbol', Symbol('s')],
    ['Date', new Date(0)],
    ['Map', new Map()],
    ['Set', new Set()],
    ['Uint8Array', new Uint8Array(2)],
    ['class instance', new Point()],
    ['cycle', cyclic],
    ['lone surrogate value', String.fromCharCode(0xd83d)],
    ['lone surrogate key', { [String.fromCharCode(0xdc00)]: 1 }],
    ['noncharacter U+FFFE', String.fromCodePoint(0xfffe)],
    ['noncharacter U+1FFFF', String.fromCodePoint(0x1ffff)],
    ['noncharacter U+FDD0', String.fromCodePoint(0xfdd0)],
  ]
  test.each(cases)('%s', (_name, value) => {
    expect(() => canonicalize(value)).toThrow(invalidJson)
  })

  test('errors name the offending path', () => {
    expect(() => canonicalize({ a: [0, { b: Number.NaN }] })).toThrow('$.a[1].b')
  })

  test('nesting is capped at MAX_JSON_DEPTH', () => {
    const nest = (depth: number): unknown => {
      let value: unknown = 0
      for (let i = 0; i < depth; i++) value = [value]
      return value
    }
    expect(canonicalize(nest(MAX_JSON_DEPTH))).toStartWith('[[')
    expect(() => canonicalize(nest(MAX_JSON_DEPTH + 1))).toThrow(invalidJson)
  })

  test('null-prototype objects are plain; toJSON is never called', () => {
    const bare = Object.create(null) as Record<string, unknown>
    bare.b = 1
    bare.a = 2
    expect(canonicalize(bare)).toBe('{"a":2,"b":1}')
    expect(canonicalize({ toJSON: 'kept as data' })).toBe('{"toJSON":"kept as data"}')
  })

  test('surrogate pairs and U+FFFD are fine; -0 serializes as 0', () => {
    const emoji = String.fromCodePoint(0x1f600)
    const replacement = String.fromCodePoint(0xfffd)
    // UTF-16 order: 'z' (0x7A) sorts before the emoji's high surrogate (0xD83D)
    expect(canonicalize({ [emoji]: replacement, z: -0 })).toBe(
      `{"z":0,"${emoji}":"${replacement}"}`,
    )
  })

  test('control characters escape as ECMAScript does (lower-case hex, short forms)', () => {
    const text = [0, 8, 9, 10, 12, 13, 31, 127].map((c) => String.fromCharCode(c)).join('')
    expect(canonicalize(text)).toBe(
      `"${esc('0000')}${BS}b${BS}t${BS}n${BS}f${BS}r${esc('001f')}${String.fromCharCode(127)}"`,
    )
  })
})

describe('agreement with @mindpeeker/negentropy canonicalJson', () => {
  const samples: unknown[] = [
    null,
    true,
    0,
    -0,
    1e21,
    1e-7,
    123456.789,
    '',
    `line\nbreak ${String.fromCharCode(7)} "quoted" ${BS} ${String.fromCodePoint(0x1d11e)}`,
    [],
    {},
    { b: [1, { d: null, c: 'x' }], a: { '': 0, A: 1, a: 2 } },
    { [String.fromCodePoint(0xe9)]: 1, e: 2, [String.fromCodePoint(0x10000)]: 3 },
  ]
  test.each(samples.map((s, i) => [i, s] as const))('sample %i', (_i, value) => {
    expect(canonicalize(value)).toBe(canonicalJson(value))
  })

  test('seeded random JSON trees agree', () => {
    let state = 0x2545f491
    const next = () => {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      state >>>= 0
      return state / 4294967296
    }
    const value = (depth: number): unknown => {
      const r = next()
      if (depth > 3 || r < 0.3) {
        return Math.round((next() - 0.5) * 1e6) / 10 ** Math.floor(next() * 8)
      }
      if (r < 0.45) return String.fromCodePoint(32 + Math.floor(next() * 2000))
      if (r < 0.6) return Array.from({ length: Math.floor(next() * 4) }, () => value(depth + 1))
      const out: Record<string, unknown> = {}
      for (let i = Math.floor(next() * 5); i > 0; i--) {
        out[String.fromCodePoint(33 + Math.floor(next() * 300))] = value(depth + 1)
      }
      return out
    }
    for (let i = 0; i < 300; i++) {
      const v = value(0)
      expect(canonicalize(v)).toBe(canonicalJson(v))
    }
  })
})
