import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import { rtlSdrArgs, rtlSdrSource } from '../../src/node/rtl-sdr.js'

describe('rtlSdrArgs', () => {
  test('builds the verified rtl_sdr invocation (stdout mode)', () => {
    expect(
      rtlSdrArgs({ frequencyHz: 70_000_000, sampleRate: 2_400_000, gain: 49.6, deviceIndex: 0 }),
    ).toEqual(['-f', '70000000', '-s', '2400000', '-g', '49.6', '-d', '0', '-'])
  })
})

describe('rtlSdrSource', () => {
  test('maps a missing binary to a network EntropyError', async () => {
    const err = (await rtlSdrSource({ rtlSdrPath: '/nonexistent/rtl_sdr-xyz' }).catch(
      (e) => e,
    )) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('network')
  })

  test('an immediately-exiting binary surfaces as a network error on read', async () => {
    const source = await rtlSdrSource({ rtlSdrPath: '/usr/bin/false' })
    try {
      const iter = source[Symbol.asyncIterator]()
      const err = (await iter.next().catch((e) => e)) as EntropyError
      expect(err).toBeInstanceOf(EntropyError)
      expect(err.code).toBe('network')
    } finally {
      source.close()
    }
  })
})
