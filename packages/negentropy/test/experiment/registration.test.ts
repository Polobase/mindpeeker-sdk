import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import {
  assertRegistrationIntact,
  canonicalJson,
  EXPERIMENT_SCHEMA,
  registerExperiment,
} from '../../src/experiment/registration.js'
import type { ExperimentConfig } from '../../src/experiment/types.js'
import { sha256Condition } from '../../src/extract/condition.js'

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Decode an IEEE 754 double from its big-endian hex bit pattern. */
function double(bits: string): number {
  const view = new DataView(new ArrayBuffer(8))
  view.setBigUint64(0, BigInt(`0x${bits}`))
  return view.getFloat64(0)
}

describe('canonicalJson (RFC 8785)', () => {
  test('RFC 8785 Appendix B number serialization', () => {
    // reference strings: an independent Python implementation (shortest repr digits +
    // the ECMAScript Number::toString layout rules), identical to the RFC's table
    const table: [string, string][] = [
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
    for (const [bits, expected] of table) expect(canonicalJson(double(bits))).toBe(expected)
    for (const bits of ['7fffffffffffffff', '7ff0000000000000']) {
      expect(() => canonicalJson(double(bits))).toThrow(NegentropyError)
    }
  })

  test('RFC 8785 §3.2.2 worked example', () => {
    const u = (...codes: number[]) => String.fromCodePoint(...codes)
    const input = {
      numbers: [Number('333333333.33333329'), 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
      // the RFC's string: EURO SIGN, $, U+000F, LINE FEED, A'B, quote, two backslashes, quote, /
      string: `${u(0x20ac)}$${u(0x0f, 0x0a)}A'B${u(0x22, 0x5c, 0x5c, 0x22)}/`,
      literals: [null, true, false],
    }
    const bs = u(0x5c)
    const expected = `{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"${u(0x20ac)}$${bs}u000f${bs}nA'B${bs}"${bs}${bs}${bs}${bs}${bs}"/"}`
    expect(canonicalJson(input)).toBe(expected)
  })

  test('RFC 8785 §3.2.3 member sorting by UTF-16 code units', () => {
    const u = (...codes: number[]) => String.fromCodePoint(...codes)
    const input = {
      [u(0x20ac)]: 'Euro Sign',
      [u(0x0d)]: 'Carriage Return',
      [u(0xfb33)]: 'Hebrew Letter Dalet With Dagesh',
      '1': 'One',
      [u(0x1f600)]: 'Emoji: Grinning Face',
      [u(0x80)]: 'Control',
      [u(0xf6)]: 'Latin Small Letter O With Diaeresis',
    }
    // (JSON.parse would reorder the integer-like key "1", so inspect the string)
    const canonical = canonicalJson(input)
    const order = [u(0x0d), '1', u(0x80), u(0xf6), u(0x20ac), u(0x1f600), u(0xfb33)].map((key) =>
      canonical.indexOf(`${JSON.stringify(key)}:`),
    )
    expect(order.every((at) => at > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  test('sorts keys recursively, no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 3, y: 4 }], c: 5 } })).toBe(
      '{"a":{"c":5,"d":[2,{"y":4,"z":3}]},"b":1}',
    )
  })

  test('rejects everything JSON cannot represent losslessly, naming the path', () => {
    const cases: unknown[] = [
      { x: Number.NaN },
      { x: Number.POSITIVE_INFINITY },
      { f: () => 1 },
      { at: new Date('2026-07-08T12:00:00.000Z') },
      { m: new Map() },
      { s: new Set([1]) },
      { r: /x/ },
      { t: new Float64Array(2) },
      { b: 10n },
      { u: undefined },
      [1, undefined],
      { sym: Symbol('x') },
      { lone: `${String.fromCharCode(0xd800)}x` },
      { nonchar: `a${String.fromCharCode(0xfffe)}` },
      { nonchar2: String.fromCharCode(0xfdd0) },
      { [String.fromCharCode(0xdc00)]: 1 },
    ]
    for (const value of cases) {
      expect(() => canonicalJson(value)).toThrow(NegentropyError)
    }
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => canonicalJson(cyclic)).toThrow(/circular/)
    expect(() => canonicalJson({ events: [{ start: new Date(0) }] })).toThrow(
      /\$\.events\[0\]\.start is a Date/,
    )
    // well-formed astral characters and a null-prototype object are fine
    const emoji = String.fromCodePoint(0x1f600)
    expect(canonicalJson(Object.assign(Object.create(null), { e: emoji }))).toBe(`{"e":"${emoji}"}`)
  })
})

describe('registerExperiment', () => {
  test('hashes the versioned, default-resolved envelope (independent Python JCS + SHA-256)', async () => {
    const minimal = await registerExperiment({
      events: [{ id: 'e1', statistic: 'netvar', start: 0, end: 100 }],
    })
    expect(minimal.schema).toBe(EXPERIMENT_SCHEMA)
    expect(minimal.canonical).toBe(
      '{"config":{"anchors":{"beacons":[]},"calibration":"theoretical","events":[{"end":100,"id":"e1","start":0,"statistic":"netvar"}],"missing":"error","trial":{"bitsPerTrial":200,"clock":{"mode":"count"}}},"schema":"negentropy/experiment/1"}',
    )
    expect(minimal.hash).toBe('2ae64ceb315823b35f394ea9a93b4f6e217c852693790ea853e89e715eca515b')
    expect(minimal.hash).toBe(
      hex(await sha256Condition(new TextEncoder().encode(minimal.canonical))),
    )

    const full = await registerExperiment({
      trial: { clock: { mode: 'interval', intervalMs: 1000 } },
      calibration: { trials: 600 },
      missing: 'skip',
      events: [
        {
          id: 'meditation-1',
          label: `group session 19:00${String.fromCharCode(0x2013)}19:20`,
          statistic: 'netvar',
          start: new Date('2026-07-08T19:00:00Z'),
          end: new Date('2026-07-08T19:20:00Z'),
        },
        { id: 'control', statistic: 'devvar', start: 200, end: 300 },
      ],
      anchors: {
        beacons: [
          {
            source: 'drand',
            chainId: '8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce',
            round: 5_000_000,
            timestamp: '2025-01-01T00:00:00Z',
            valueHex: 'AB12CD', // hashed lower-cased
          },
        ],
      },
    })
    expect(full.hash).toBe('941088be9481f93c033b438e183406ba748258ce9fcfe5d6dc26bd98379e56de')
    expect(full.config.events[0]?.start).toBeInstanceOf(Date)
  })

  test('explicit defaults, key order and calibration order do not change the hash; content does', async () => {
    const implicit = await registerExperiment({
      events: [{ id: 'e1', statistic: 'netvar', start: 0, end: 100 }],
    })
    const explicit = await registerExperiment({
      missing: 'error',
      calibration: 'theoretical',
      anchors: { beacons: [] },
      trial: { clock: { mode: 'count' }, bitsPerTrial: 200 },
      events: [{ statistic: 'netvar', end: 100, start: 0, id: 'e1', label: undefined }],
    })
    expect(explicit.hash).toBe(implicit.hash)
    const different = await registerExperiment({
      events: [{ id: 'e1', statistic: 'netvar', start: 0, end: 101 }],
    })
    expect(different.hash).not.toBe(implicit.hash)

    const cal = (source: string, mean: number) => ({
      source,
      bitsPerTrial: 200,
      trials: 500,
      mean,
      sd: 7,
      basis: 'empirical' as const,
    })
    const ab = await registerExperiment({ calibration: [cal('a', 100), cal('b', 101)] })
    const ba = await registerExperiment({ calibration: [cal('b', 101), cal('a', 100)] })
    expect(ab.hash).toBe(ba.hash)
  })

  test('validates the config: ids, windows, widths, calibrations, anchors, unknown keys', async () => {
    const reject = async (config: unknown, code: string) => {
      await expect(registerExperiment(config as ExperimentConfig)).rejects.toMatchObject({ code })
    }
    const event = { id: 'e', statistic: 'netvar', start: 0, end: 10 }
    await reject({ events: [event, event] }, 'invalid_config') // duplicate ids
    await reject({ events: [{ ...event, id: '' }] }, 'invalid_config')
    await reject({ events: [{ ...event, statistic: 'variance' }] }, 'invalid_config')
    await reject({ events: [{ ...event, start: 10, end: 10 }] }, 'invalid_window')
    await reject({ events: [{ ...event, start: -1 }] }, 'invalid_window')
    await reject({ events: [{ ...event, start: 1.5 }] }, 'invalid_window')
    await reject({ events: [{ ...event, start: new Date(0) }] }, 'invalid_window') // mixed
    await reject(
      { events: [{ ...event, start: new Date('2026-13-01T19:00Z'), end: new Date(1) }] },
      'invalid_window',
    )
    await reject({ trial: { bitsPerTrial: 4 } }, 'invalid_config')
    await reject({ trial: { clock: { mode: 'interval', intervalMs: 0 } } }, 'invalid_config')
    await reject({ calibration: { trials: 1 } }, 'invalid_config')
    const good = { source: 'a', bitsPerTrial: 200, trials: 9, mean: 100, sd: 7, basis: 'empirical' }
    await reject({ calibration: [good, good] }, 'invalid_config')
    await reject({ calibration: [{ ...good, sd: 0 }] }, 'invalid_config')
    await reject({ calibration: [{ ...good, mean: Number.NaN }] }, 'invalid_config')
    await reject({ calibration: [{ ...good, bitsPerTrial: 64 }] }, 'invalid_config') // ≠ trial width
    await reject({ missing: 'ignore' }, 'invalid_config')
    await reject({ event: [event] }, 'invalid_config') // typo → unknown key
    await reject({ events: [{ ...event, note: 'x' }] }, 'invalid_config')
    const beacon = { source: 'nist', chainId: '2', round: 1, timestamp: '2025-01-01T00:00:00Z' }
    await reject({ anchors: { beacons: [{ ...beacon, valueHex: 'abc' }] } }, 'invalid_config')
    await reject(
      { anchors: { beacons: [{ ...beacon, valueHex: 'ab', round: -1 }] } },
      'invalid_config',
    )
    await reject(
      { anchors: { beacons: [{ ...beacon, valueHex: 'ab', timestamp: 'soon' }] } },
      'invalid_config',
    )
  })

  test('the registered config is deeply frozen and tamper-evident', async () => {
    const registration = await registerExperiment({
      events: [{ id: 'e1', statistic: 'netvar', start: new Date(1000), end: new Date(2000) }],
    })
    const { config: frozen } = registration
    expect(() => {
      ;(frozen as { missing?: string }).missing = 'skip'
    }).toThrow(TypeError)
    expect(() => {
      ;(frozen.events[0] as unknown as { id: string }).id = 'tampered'
    }).toThrow(TypeError)
    expect(() => assertRegistrationIntact(registration)).not.toThrow()
    // a frozen Date is still mutable through setTime — the canonical check catches it
    ;(frozen.events[0]?.start as Date).setTime(0)
    expect(() => assertRegistrationIntact(registration)).toThrow(/modified after hashing/)
    expect(() =>
      assertRegistrationIntact({ config: frozen, hash: registration.hash } as never),
    ).toThrow(NegentropyError)
  })
})
