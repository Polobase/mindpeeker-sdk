import { describe, expect, test } from 'bun:test'
import { parseStrictPulse, serializePulseFields } from '../../src/internal/nist-verify.js'
import { inmetro } from '../../src/providers/inmetro.js'
import { nistBeacon } from '../../src/providers/nist-beacon.js'
import { nqsn } from '../../src/providers/nqsn.js'
import { uchile } from '../../src/providers/uchile.js'
import { rejectedEntropyError, thrownEntropyError } from '../helpers/errors.js'
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

// ---------- Opt-in pulse verification against live fixtures ----------

const FIXTURES = `${import.meta.dir}/../fixtures/beacons`

async function fixturePulse(file: string): Promise<Record<string, unknown>> {
  return ((await Bun.file(`${FIXTURES}/${file}`).json()) as { pulse: Record<string, unknown> })
    .pulse
}

/** Serve fixture pulses by (chain, pulse) and certificates by id prefix, counting requests. */
async function fixtureMock(
  pulses: string[],
  latest: string,
  certificates: Record<string, string> = {},
) {
  const byIndex = new Map<string, Record<string, unknown>>()
  for (const file of pulses) {
    const p = await fixturePulse(file)
    byIndex.set(`${p.chainIndex}/${p.pulseIndex}`, p)
  }
  const latestPulse = await fixturePulse(latest)
  const pems = new Map<string, string>()
  for (const [prefix, file] of Object.entries(certificates)) {
    pems.set(prefix, await Bun.file(`${FIXTURES}/${file}`).text())
  }
  let certificateRequests = 0
  const mock = mockFetch((req) => {
    const cert = req.url.match(/\/certificate\/([0-9a-f]{16})[0-9a-f]*$/i)
    if (cert) {
      certificateRequests++
      const pem = pems.get((cert[1] as string).toLowerCase())
      return pem ? new Response(pem, { status: 200 }) : new Response('nope', { status: 404 })
    }
    const indexed = req.url.match(/\/chain\/(\d+)\/pulse\/(\d+)$/)
    if (indexed) {
      const p = byIndex.get(`${indexed[1]}/${indexed[2]}`)
      return p ? jsonResponse({ pulse: p }) : new Response('not found', { status: 404 })
    }
    return jsonResponse({ pulse: latestPulse })
  })
  return { ...mock, certificateRequests: () => certificateRequests }
}

describe('verify', () => {
  test('nqsn verify: true checks output, certificate and signature (certificate cached)', async () => {
    const mock = await fixtureMock(['nqsn-1-593768.json'], 'nqsn-1-593768.json', {
      a0b3337b34f96a65: 'nqsn-cert-a0b3337b34f96a65.pem',
    })
    const p = nqsn({ fetch: mock.fetch, verify: true })
    const first = await p.getBytes(64)
    const second = await p.getBytes(64)
    expect(first.bytes).toEqual(second.bytes)
    expect(mock.certificateRequests()).toBe(1)
    expect(mock.calls[1]?.url).toBe(
      `https://quantum-entropy.sg/beacon/2.0/certificate/${(await fixturePulse('nqsn-1-593768.json')).certificateId}`,
    )
  })

  test('nistBeacon verify: true rejects current pulses whose signature cannot match the certificate', async () => {
    const mock = await fixtureMock(['nist-2-1945335.json'], 'nist-2-1945335.json', {
      '87f27f431da3f584': 'nist-cert-87f27f431da3f584.pem',
    })
    const err = await rejectedEntropyError(
      nistBeacon({ fetch: mock.fetch, verify: true }).getBytes(32),
      'verification',
    )
    expect(err.message).toContain('signatureValue')
  })

  test('nistBeacon verify: true accepts a pulse signed by its certificate (2026-09-01)', async () => {
    const mock = await fixtureMock(['nist-2-1921596.json'], 'nist-2-1921596.json', {
      '528943a555f5f8ca': 'nist-cert-528943a555f5f8ca.pem',
    })
    const { bytes, sources } = await nistBeacon({ fetch: mock.fetch, verify: true }).getBytes(64)
    expect(Buffer.from(bytes).toString('hex').toUpperCase()).toBe(
      (await fixturePulse('nist-2-1921596.json')).outputValue as string,
    )
    expect(sources[0]?.rounds?.[0]).toMatchObject({ round: 1921596, chain: 2 })
  })

  test("verify: 'hash' walks back with output and linkage checks, no certificate", async () => {
    const mock = await fixtureMock(
      ['nist-2-1945334.json', 'nist-2-1945335.json'],
      'nist-2-1945335.json',
    )
    const { bytes } = await nistBeacon({ fetch: mock.fetch, verify: 'hash' }).getBytes(128)
    expect(bytes.length).toBe(128)
    expect(mock.certificateRequests()).toBe(0)
  })

  test("verify: 'hash' rejects a relabelled historical pulse during a walk", async () => {
    const earlier = await fixturePulse('nist-2-1945334.json')
    const later = await fixturePulse('nist-2-1945335.json')
    // a genuine but unrelated pulse relabelled as the predecessor
    const impostor = { ...(await fixturePulse('nist-2-1921596.json')), pulseIndex: 1945334 }
    const { fetch } = mockFetch((req) =>
      req.url.endsWith('/chain/2/pulse/1945334')
        ? jsonResponse({ pulse: impostor })
        : jsonResponse({ pulse: later }),
    )
    expect(earlier.pulseIndex).toBe(1945334)
    // the relabelled pulse no longer hashes to its outputValue
    await rejectedEntropyError(nistBeacon({ fetch, verify: 'hash' }).getBytes(128), 'verification')
  })

  test("inmetro verify: 'hash' accepts the length-prefixed signature encoding", async () => {
    const mock = await fixtureMock(['inmetro-2-957117.json'], 'inmetro-2-957117.json')
    const { bytes } = await inmetro({ fetch: mock.fetch, verify: 'hash' }).getBytes(16)
    expect(bytes.length).toBe(16)
  })

  test('a cipherSuite other than 0 cannot be verified', async () => {
    const pulse = { ...(await fixturePulse('nqsn-1-593768.json')), cipherSuite: 1 }
    const { fetch } = mockFetch(() => jsonResponse({ pulse }))
    const err = await rejectedEntropyError(
      nqsn({ fetch, verify: 'hash' }).getBytes(8),
      'verification',
    )
    expect(err.message).toContain('cipherSuite 1')
  })

  test("verify: 'hash' rejects consecutive pulses that do not link", async () => {
    // Two self-consistent synthetic pulses (outputValue recomputed with the
    // serializer pinned above) whose chain linkage is broken.
    const template = await fixturePulse('nist-2-1945335.json')
    async function sealed(pulseIndex: number, previous: string) {
      const listValues = (template.listValues as { type: string; value: string }[]).map((entry) =>
        entry.type === 'previous' ? { ...entry, value: previous } : entry,
      )
      const pulse = { ...template, pulseIndex, listValues }
      const fields = serializePulseFields(parseStrictPulse(pulse, 'test'))
      const signature = Buffer.from(template.signatureValue as string, 'hex')
      const joined = new Uint8Array([...fields, ...signature])
      const output = new Uint8Array(await crypto.subtle.digest('SHA-512', joined))
      return { ...pulse, outputValue: Buffer.from(output).toString('hex').toUpperCase() }
    }
    const earlier = await sealed(10, '11'.repeat(64))
    const later = await sealed(11, '22'.repeat(64)) // should be earlier.outputValue
    const { fetch } = mockFetch((req) =>
      jsonResponse({ pulse: req.url.endsWith('/chain/2/pulse/10') ? earlier : later }),
    )
    const err = await rejectedEntropyError(
      nistBeacon({ fetch, verify: 'hash' }).getBytes(128),
      'verification',
    )
    expect(err.message).toContain('previous value')
  })

  test('uchile publishes cipherSuite 1 and refuses a verify option', () => {
    thrownEntropyError(() => uchile({ verify: true } as never), 'invalid_request')
  })
})
