// Canonical-JSON material for the ledger page: RFC 8785 worked examples, the
// cyberphone JCS reference cases the package tests against, and the values
// canonicalize refuses.
//
// CLIENT-ONLY — imports @mindpeeker/ledger.

import { canonicalize, sha256Hex } from '@mindpeeker/ledger'

const BS = String.fromCharCode(92)
/** A JSON `\uXXXX` escape as source text (assembled, so no literal escape sits here). */
const esc = (code: string) => `${BS}u${code}`

/** RFC 8785 §3.2.2's string member, escape for escape. */
const RFC_STRING = `"${esc('20ac')}$${esc('000F')}${esc('000a')}A'${esc('0042')}${esc('0022')}${esc('005c')}${BS}${BS}${BS}"${BS}/"`

export interface JsonPreset {
  readonly id: string
  readonly label: string
  /** What this input is meant to show. */
  readonly note: string
  /** The JSON source text, as a human would type it. */
  readonly text: string
  /** The canonical form the RFC or the reference vectors require, when one is published. */
  readonly expected?: string
}

export const JSON_PRESETS: readonly JsonPreset[] = [
  {
    id: 'rfc-8785',
    label: 'RFC 8785 §3.2.2 worked example',
    note: 'The specification’s own input: number forms, escapes and key order all at once. The canonical output below is §3.2.3, byte for byte.',
    text: `{
  "numbers": [333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],
  "string": ${RFC_STRING},
  "literals": [null, true, false]
}`,
    expected: `{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$${BS}u000f${BS}nA'B${BS}"${BS}${BS}${BS}${BS}${BS}"/"}`,
  },
  {
    id: 'structures',
    label: 'JCS reference case: structures',
    note: 'From the cyberphone/json-canonicalization test data named in RFC 8785 Appendix I: nested objects, empty keys and integer-like keys sorted as UTF-16 code units, not numerically.',
    text: `{
  "1": {"f": {"f": "hi","F": 5} ,"${BS}n": 56.0},
  "10": { },
  "": "empty",
  "a": { },
  "111": [ {"e": "yes","E": "no" } ],
  "A": { }
}`,
    expected: `{"":"empty","1":{"${BS}n":56,"f":{"F":5,"f":"hi"}},"10":{},"111":[{"E":"no","e":"yes"}],"A":{},"a":{}}`,
  },
  {
    id: 'french',
    label: 'JCS reference case: locale is ignored',
    note: 'Sorting compares UTF-16 code units. “péché” before “pêche” is wrong for a French reader and right for a canonicalizer: two implementations must agree, not two dictionaries.',
    text: `{
  "peach": "This sorting order",
  "péché": "is wrong according to French",
  "pêche": "but canonicalization MUST",
  "sin":   "ignore locale"
}`,
    expected: `{"peach":"This sorting order","péché":"is wrong according to French","pêche":"but canonicalization MUST","sin":"ignore locale"}`,
  },
  {
    id: 'registration',
    label: 'A record you would actually hash',
    note: 'The shape of a chain record: the same content written with different whitespace and key order hashes identically, which is the entire point.',
    text: `{
  "run": 3,
  "arm": "experimental",
  "sum": 1012,
  "bitsPerTrial": 200,
  "source": "truerng-3"
}`,
  },
  {
    id: 'numbers',
    label: 'Number edge cases (RFC 8785 Appendix B)',
    note: 'ECMAScript shortest round-trip form: −0 becomes 0, 1e21 switches to exponential, 1e-7 does too, and 9007199254740992 + 1 is not representable.',
    text: `{
  "minusZero": -0,
  "tiny": 5e-324,
  "justBelowExponential": 999999999999999900000,
  "exponential": 1e21,
  "smallestPlain": 0.000001,
  "smallestExponential": 9.999999999999997e-7,
  "maxSafe": 9007199254740992,
  "biggest": 1.7976931348623157e308
}`,
  },
]

/** One value canonicalize refuses, with the source you would have written. */
export interface RejectedSample {
  readonly label: string
  readonly code: string
  readonly why: string
  readonly build: () => unknown
}

function cyclic(): unknown {
  const node: Record<string, unknown> = { id: 'run-3' }
  node.self = node
  return node
}

function deep(): unknown {
  let value: unknown = 1
  for (let i = 0; i < 600; i++) value = [value]
  return value
}

export const REJECTED_SAMPLES: readonly RejectedSample[] = [
  {
    label: 'Date',
    code: `canonicalize({ at: new Date('2026-09-17T12:00:00Z') })`,
    why: 'A Date has no JSON form. 0.1’s canonicalJson silently wrote the ISO string, so two different configurations could share one hash. Convert it yourself: at.toISOString().',
    build: () => ({ at: new Date('2026-09-17T12:00:00Z') }),
  },
  {
    label: 'Map',
    code: `canonicalize({ counts: new Map([['hi', 3]]) })`,
    why: 'JSON.stringify turns a Map into {} — every Map would hash the same. Convert it: Object.fromEntries(counts).',
    build: () => ({ counts: new Map([['hi', 3]]) }),
  },
  {
    label: 'BigInt',
    code: `canonicalize({ trials: 9007199254740993n })`,
    why: 'JSON has no bigint. Write it as a decimal string so the reader sees exactly the digits you hashed.',
    build: () => ({ trials: BigInt('9007199254740993') }),
  },
  {
    label: 'Uint8Array',
    code: `canonicalize({ seed: new Uint8Array([1, 2, 3]) })`,
    why: 'A typed array serializes as {"0":1,"1":2,…} — technically JSON, semantically a lie. Convert it: toHex(seed).',
    build: () => ({ seed: new Uint8Array([1, 2, 3]) }),
  },
  {
    label: 'NaN',
    code: `canonicalize({ z: Number.NaN })`,
    why: 'JSON.stringify writes null for NaN and ±Infinity, so a failed statistic would hash as a recorded null.',
    build: () => ({ z: Number.NaN }),
  },
  {
    label: 'undefined member',
    code: `canonicalize({ alpha: 0.05, correction: undefined })`,
    why: 'JSON.stringify drops the member, so a config with and without it would hash identically. Omit it deliberately instead.',
    build: () => ({ alpha: 0.05, correction: undefined }),
  },
  {
    label: 'array hole',
    code: `canonicalize({ sums: [1, , 3] })`,
    why: 'A sparse array writes null in the gap. A missing trial is not a zero trial.',
    build: () => {
      const holed = new Array<number>(3)
      holed[0] = 1
      holed[2] = 3
      return { sums: holed }
    },
  },
  {
    label: 'lone surrogate',
    code: `canonicalize({ note: '\\ud800' })`,
    why: 'RFC 7493 (I-JSON): a lone surrogate has no UTF-8 encoding, so the hashed bytes would depend on the encoder.',
    build: () => ({ note: String.fromCharCode(0xd800) }),
  },
  {
    label: 'cycle',
    code: `node.self = node; canonicalize(node)`,
    why: 'A cycle cannot terminate. JSON.stringify throws a TypeError here; canonicalize throws a typed LedgerError you can branch on.',
    build: cyclic,
  },
  {
    label: 'nesting > MAX_JSON_DEPTH',
    code: `canonicalize(nest(600))  // MAX_JSON_DEPTH = 512`,
    why: 'A depth limit keeps a hostile record from exhausting the stack of every verifier that reads your log.',
    build: deep,
  },
]

export interface CanonicalReport {
  readonly ok: boolean
  readonly canonical?: string
  readonly bytes?: number
  readonly hash?: string
  /** A LedgerError from canonicalize, or a SyntaxError from JSON.parse. */
  readonly error?: unknown
}

/** Parse JSON text, canonicalize it, hash the UTF-8 bytes. Never throws. */
export async function canonicalReport(text: string): Promise<CanonicalReport> {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return { ok: false, error }
  }
  let canonical: string
  try {
    canonical = canonicalize(value)
  } catch (error) {
    return { ok: false, error }
  }
  return {
    ok: true,
    canonical,
    bytes: new TextEncoder().encode(canonical).length,
    hash: await sha256Hex(canonical),
  }
}

/** Try canonicalize on a value, returning the thrown error instead of throwing. */
export function tryCanonicalize(build: () => unknown): { ok: boolean; error?: unknown } {
  try {
    canonicalize(build())
    return { ok: true }
  } catch (error) {
    return { ok: false, error }
  }
}

/**
 * The same content written differently: keys reversed, two-space indent. Its
 * canonical form — and therefore its hash — must be identical.
 */
export function respell(text: string): string {
  const flip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(flip)
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>).reverse()
      return Object.fromEntries(entries.map(([key, child]) => [key, flip(child)]))
    }
    return value
  }
  try {
    return JSON.stringify(flip(JSON.parse(text)), null, 4)
  } catch {
    return text
  }
}
