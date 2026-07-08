import { describe, expect, test } from 'bun:test'
import { inmetro } from '../../src/providers/inmetro.js'
import { nqsn } from '../../src/providers/nqsn.js'
import { uchile } from '../../src/providers/uchile.js'
import { jsonResponse, mockFetch } from '../helpers/mock-fetch.js'
import { providerContract } from '../helpers/provider-contract.js'

function outputFor(pulseIndex: number): string {
  return (pulseIndex % 256).toString(16).padStart(2, '0').toUpperCase().repeat(64)
}

/**
 * Generic NIST-family mock: serves a latest pulse at `latestMatch` and
 * historical pulses at any URL ending in /pulse/{n} (or /{n} for the
 * Inmetro-combination quirk).
 */
function familyMock(opts: {
  latestMatch: (url: string) => boolean
  chainIndex: number
  latestIndex?: number
}) {
  const { latestMatch, chainIndex, latestIndex = 500 } = opts
  return mockFetch((req) => {
    let pulseIndex: number
    if (latestMatch(req.url)) {
      pulseIndex = latestIndex
    } else {
      const match = req.url.match(/\/pulse\/(\d+)$/) ?? req.url.match(/\/(\d+)$/)
      if (!match) return new Response('not found', { status: 404 })
      pulseIndex = Number(match[1])
    }
    return jsonResponse({
      pulse: { chainIndex, pulseIndex, period: 60_000, outputValue: outputFor(pulseIndex) },
    })
  })
}

// ---------- NQSN Singapore ----------

providerContract(
  'nqsn',
  () =>
    nqsn({
      fetch: familyMock({ latestMatch: (u) => u.endsWith('/pulse'), chainIndex: 1 }).fetch,
      pollIntervalMs: 1,
    }),
  { kind: 'beacon', privacy: 'public', lengths: [1, 16, 130], streamChunkBytes: 8 },
)

describe('nqsn', () => {
  test('is named nqsn, public beacon', () => {
    const p = nqsn()
    expect(p.name).toBe('nqsn')
    expect(p.kind).toBe('beacon')
    expect(p.privacy).toBe('public')
  })

  test('requests /pulse for the latest and walks /chain/1/pulse/{n}', async () => {
    const mock = familyMock({ latestMatch: (u) => u.endsWith('/pulse'), chainIndex: 1 })
    const { bytes } = await nqsn({ fetch: mock.fetch }).getBytes(130)
    expect(bytes.length).toBe(130)
    expect(
      mock.calls.map((c) => c.url.replace('https://quantum-entropy.sg/beacon/2.0', '')),
    ).toEqual(['/pulse', '/chain/1/pulse/499', '/chain/1/pulse/498'])
  })
})

// ---------- Random UChile ----------

providerContract(
  'uchile',
  () =>
    uchile({
      fetch: familyMock({
        latestMatch: (u) => u.includes('/pulse?chainId=last&pulseId=last'),
        chainIndex: 2,
      }).fetch,
      pollIntervalMs: 1,
    }),
  { kind: 'beacon', privacy: 'public', lengths: [1, 16, 130], streamChunkBytes: 8 },
)

describe('uchile', () => {
  test('uses the query-form latest (the /pulse/last route is 404 upstream)', async () => {
    const mock = familyMock({
      latestMatch: (u) => u.includes('/pulse?chainId=last&pulseId=last'),
      chainIndex: 2,
    })
    await uchile({ fetch: mock.fetch }).getBytes(70)
    expect(mock.calls[0]?.url).toBe(
      'https://random.uchile.cl/beacon/2.1-beta/pulse?chainId=last&pulseId=last',
    )
    expect(mock.calls[1]?.url).toBe('https://random.uchile.cl/beacon/2.1-beta/chain/2/pulse/499')
  })

  test('is named uchile', () => {
    expect(uchile().name).toBe('uchile')
  })
})

// ---------- Inmetro ----------

providerContract(
  'inmetro (primary)',
  () =>
    inmetro({
      fetch: familyMock({ latestMatch: (u) => u.endsWith('/pulse/last'), chainIndex: 2 }).fetch,
      pollIntervalMs: 1,
    }),
  { kind: 'beacon', privacy: 'public', lengths: [1, 16, 130], streamChunkBytes: 8 },
)

describe('inmetro', () => {
  test('primary variant hits /beacon/2.1/pulse/last', async () => {
    const mock = familyMock({ latestMatch: (u) => u.endsWith('/pulse/last'), chainIndex: 2 })
    await inmetro({ fetch: mock.fetch }).getBytes(8)
    expect(mock.calls[0]?.url).toBe('https://beacon.inmetro.gov.br/beacon/2.1/pulse/last')
    expect(inmetro().name).toBe('inmetro')
  })

  test('combination variant uses /last for latest but /pulse/{n} for history', async () => {
    const mock = familyMock({ latestMatch: (u) => u.endsWith('/2.0/last'), chainIndex: 1 })
    const p = inmetro({ variant: 'combination', fetch: mock.fetch })
    expect(p.name).toBe('inmetro(combination)')
    await p.getBytes(70)
    expect(mock.calls[0]?.url).toBe('https://beacon.inmetro.gov.br/combination/beacon/2.0/last')
    expect(mock.calls[1]?.url).toBe(
      'https://beacon.inmetro.gov.br/combination/beacon/2.0/pulse/499',
    )
  })
})
