import { describe, expect, test } from 'bun:test'
import * as providers from '../../src/providers/index.js'
import type { BeaconProvider, EntropyProvider } from '../../src/types.js'

/** Entropy backends: one factory per source (serial presets are listed separately). */
const BACKENDS = [
  'anu',
  'anuLegacy',
  'bitcoinBeacon',
  'cameraEntropy',
  'cryptoProvider',
  'curby',
  'drand',
  'drbgProvider',
  'flowBeacon',
  'inmetro',
  'jitterEntropy',
  'lfdr',
  'micEntropy',
  'nistBeacon',
  'nqsn',
  'outshift',
  'padova',
  'qbck',
  'qci',
  'qrandomIo',
  'randao',
  'randomOrg',
  'sdrEntropy',
  'sensorEntropy',
  'serialEntropy',
  'solanaBeacon',
  'superRand',
  'tezosBeacon',
  'uchile',
]
const PRESETS = ['onerng', 'truerng']
const HELPERS = [
  'drandRoundAt',
  'drandRoundTime',
  'iqLsbBits',
  'jitterStartupTest',
  'lsbBits',
  'sameSampledPixels',
  'sampleLsbBits',
  'sensorReadingBytes',
  'signBits',
]

describe('@mindpeeker/entropy/providers exports', () => {
  test('every exported function is a known backend, serial preset or helper', () => {
    const functions = Object.entries(providers)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort()
    expect(functions).toEqual([...BACKENDS, ...PRESETS, ...HELPERS].sort())
  })

  test('the README states the backend count derived from the code', async () => {
    const readme = await Bun.file(`${import.meta.dir}/../../README.md`).text()
    const words = ['Twenty-nine', 'Thirty', 'Thirty-one', 'Thirty-two']
    const total = BACKENDS.length + 1 // + hwRng from /node
    expect(readme).toContain(
      `${words[total - 29]} entropy backends (${BACKENDS.length} in \`/providers\``,
    )
  })

  test('beacons with historical access expose getRound', () => {
    const offline = () => Promise.reject(new TypeError('offline')) as Promise<Response>
    const fetch = offline as unknown as typeof globalThis.fetch
    const beacons: EntropyProvider[] = [
      providers.drand({ fetch }),
      providers.nistBeacon({ fetch }),
      providers.nqsn({ fetch }),
      providers.uchile({ fetch }),
      providers.inmetro({ fetch }),
      providers.curby({ fetch }),
      providers.tezosBeacon({ fetch }),
      providers.randao({ fetch }),
    ]
    for (const beacon of beacons) {
      expect(typeof (beacon as BeaconProvider).getRound).toBe('function')
    }
    for (const chain of [
      providers.bitcoinBeacon({ fetch }),
      providers.solanaBeacon({ fetch }),
      providers.flowBeacon({ fetch }),
    ]) {
      expect('getRound' in chain).toBe(false)
    }
  })
})
