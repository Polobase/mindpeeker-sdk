import { describe, expect, test } from 'bun:test'
import { RateError } from '../src/errors.js'
import { phaseModulate, rateMask, xorImprint } from '../src/modulate.js'
import { TAU } from '../src/types.js'
import { chunkSource, collect, collectFloats, prngBytes } from './helpers/byte-sources.js'

const RATE = { digits: [12, 33, 7], base: 44 }

describe('rateMask', () => {
  test('is deterministic', () => {
    expect(rateMask(RATE, 32)).toEqual(rateMask(RATE, 32))
  })

  test('is periodic with period = digit count', () => {
    const mask = rateMask(RATE, 30)
    const r = RATE.digits.length
    for (let i = 0; i + r < mask.length; i++) {
      expect(mask[i]).toBe(mask[i + r] as number)
    }
  })

  test('hand value: digit 11 (base 44) -> theta pi/2 -> byte 64', () => {
    const mask = rateMask({ digits: [11], base: 44 }, 4)
    expect([...mask]).toEqual([64, 64, 64, 64])
  })

  test('digit 0 -> byte 0', () => {
    expect([...rateMask({ digits: [0], base: 44 }, 3)]).toEqual([0, 0, 0])
  })

  test('rejects an empty rate and negative length', () => {
    expect(() => rateMask({ digits: [], base: 44 }, 4)).toThrow(RateError)
    expect(() => rateMask(RATE, -1)).toThrow(RateError)
  })
})

describe('xorImprint', () => {
  test('applying it twice with the same rate is the identity', async () => {
    const data = prngBytes(500)
    const once = await collect(xorImprint(data, RATE))
    const twice = await collect(xorImprint(once, RATE))
    expect([...twice]).toEqual([...data])
  })

  test('imprint by an all-zero mask (digit 0) is a no-op', async () => {
    const data = prngBytes(64)
    const out = await collect(xorImprint(data, { digits: [0], base: 44 }))
    expect([...out]).toEqual([...data])
  })

  test('cycles the mask across chunk boundaries the same as one buffer', async () => {
    const whole = prngBytes(90)
    const a = whole.subarray(0, 17)
    const b = whole.subarray(17, 50)
    const c = whole.subarray(50)
    const chunked = await collect(xorImprint(chunkSource('s', [a, b, c]), RATE))
    const single = await collect(xorImprint(whole, RATE))
    expect([...chunked]).toEqual([...single])
  })

  test('honours an already-aborted signal', async () => {
    const ac = new AbortController()
    ac.abort()
    const run = collect(xorImprint(prngBytes(8), RATE, { signal: ac.signal }))
    await expect(run).rejects.toThrow(RateError)
    try {
      await collect(xorImprint(prngBytes(8), RATE, { signal: ac.signal }))
    } catch (err) {
      expect((err as RateError).code).toBe('aborted')
    }
  })
})

describe('phaseModulate', () => {
  test('hand values for a single zero-phase ring', async () => {
    const data = Uint8Array.from([0, 64, 128, 192])
    const phases = await collectFloats(phaseModulate(data, { digits: [0], base: 44 }))
    expect(phases[0]).toBeCloseTo(0, 14)
    expect(phases[1]).toBeCloseTo(Math.PI / 2, 14)
    expect(phases[2]).toBeCloseTo(Math.PI, 14)
    expect(phases[3]).toBeCloseTo((3 * Math.PI) / 2, 14)
  })

  test('rotates by the ring phase (digit 11 -> +pi/2)', async () => {
    const phases = await collectFloats(
      phaseModulate(Uint8Array.from([0]), { digits: [11], base: 44 }),
    )
    expect(phases[0]).toBeCloseTo(Math.PI / 2, 14)
  })

  test('all phases lie in [0, 2pi)', async () => {
    const phases = await collectFloats(phaseModulate(prngBytes(300), RATE))
    for (const p of phases) {
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThan(TAU)
    }
  })

  test('is deterministic', async () => {
    const a = await collectFloats(phaseModulate(prngBytes(128), RATE))
    const b = await collectFloats(phaseModulate(prngBytes(128), RATE))
    expect([...a]).toEqual([...b])
  })

  test('ring cycling is continuous across chunk boundaries', async () => {
    const rate = { digits: [0, 22], base: 44 } // phases 0 and pi
    const whole = prngBytes(41)
    const chunked = await collectFloats(
      phaseModulate(chunkSource('s', [whole.subarray(0, 10), whole.subarray(10)]), rate),
    )
    const single = await collectFloats(phaseModulate(whole, rate))
    expect([...chunked]).toEqual([...single])
  })

  test('empty rate throws invalid_rate', async () => {
    const run = collectFloats(phaseModulate(prngBytes(4), { digits: [], base: 44 }))
    await expect(run).rejects.toThrow(RateError)
  })
})
