import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import {
  checkPulseLinkage,
  checkPulseOutput,
  checkPulseSignature,
  importPulseCertificate,
  parseStrictPulse,
  serializePulseFields,
} from '../../src/internal/nist-verify.js'
import { pemToDer, spkiFromCertificate } from '../../src/internal/x509.js'

// Live pulses and certificates fetched 2026-09-17 (see fixtures/beacons). The
// reference digests below were computed independently in Python
// (`cryptography` 46: x509 SPKI export, RSA PKCS#1 v1.5/SHA-512 verify) from
// the same files.
const FIXTURES = `${import.meta.dir}/../fixtures/beacons`

async function pulse(file: string): Promise<Record<string, unknown>> {
  const json = (await Bun.file(`${FIXTURES}/${file}`).json()) as { pulse: Record<string, unknown> }
  return json.pulse
}

async function pem(file: string): Promise<string> {
  return Bun.file(`${FIXTURES}/${file}`).text()
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Buffer.from(digest).toString('hex')
}

const REFERENCE = {
  'nist-2-1921596.json': {
    fieldsLength: 807,
    fieldsSha256: 'fd056fdbc4f33fc3cbc6a9a490ac69bf9d6bb1aeeca9a6826e853c7909470ad6',
  },
  'nist-2-1945335.json': {
    fieldsLength: 807,
    fieldsSha256: '3b8abfbd57f59884d810659bd685f08673159103bb57acca62804f2d99b4ec4b',
  },
  'nqsn-1-593768.json': {
    fieldsLength: 809,
    fieldsSha256: 'f86a1c777a30452ddc6dc3f1c1bf8bd5b0f362a6fcad3427f65837e7bfdb3b0a',
  },
  'inmetro-2-957117.json': {
    fieldsLength: 812,
    fieldsSha256: 'b52898d488fd793c200978a781bcefec3b1f50791188aa830775a1dbf8b71d75',
  },
} as const

const SPKI_SHA256 = {
  'nist-cert-528943a555f5f8ca.pem':
    '7992fd551897e0af240631bce710a29ec2ec12275cd24738a6f1d697c7e91d0f',
  'nist-cert-87f27f431da3f584.pem':
    'e46b49d5ab84051c11eee4951a7fb9230a54b986a193f434043b3dc44a5de4b6',
  'nqsn-cert-a0b3337b34f96a65.pem':
    '112bd3e33d0f0278c56f8478afedffb49f306228ba7a0e29e05ba1b1856a8e75',
} as const

describe('serializePulseFields (deployed IR 8213 layout)', () => {
  for (const [file, ref] of Object.entries(REFERENCE)) {
    test(`matches the independent serialization of ${file}`, async () => {
      const fields = serializePulseFields(parseStrictPulse(await pulse(file), 'test'))
      expect(fields.length).toBe(ref.fieldsLength)
      expect(await sha256Hex(fields)).toBe(ref.fieldsSha256)
    })
  }
})

describe('x509', () => {
  for (const [file, digest] of Object.entries(SPKI_SHA256)) {
    test(`extracts the SubjectPublicKeyInfo of ${file}`, async () => {
      const spki = spkiFromCertificate(pemToDer(await pem(file)))
      expect(await sha256Hex(spki)).toBe(digest)
    })
  }

  test('rejects text without a certificate block and truncated DER', () => {
    expect(() => pemToDer('hello')).toThrow(TypeError)
    expect(() => spkiFromCertificate(new Uint8Array([0x30, 0x82, 0x01]))).toThrow(TypeError)
    expect(() => spkiFromCertificate(new Uint8Array([0x02, 0x01, 0x00]))).toThrow(TypeError)
  })
})

describe('checkPulseOutput', () => {
  test('accepts NIST and NQSN (raw signature) and Inmetro (length-prefixed signature)', async () => {
    for (const file of Object.keys(REFERENCE)) {
      await checkPulseOutput(parseStrictPulse(await pulse(file), 'test'), 'test')
    }
  })

  test('rejects a pulse whose fields were altered', async () => {
    const raw = await pulse('nist-2-1921596.json')
    const tampered = parseStrictPulse({ ...raw, timeStamp: '2026-09-01T00:01:00.000Z' }, 'test')
    const err = (await checkPulseOutput(tampered, 'nist').catch((e) => e)) as EntropyError
    expect(err).toBeInstanceOf(EntropyError)
    expect(err.code).toBe('verification')
    expect(err.provider).toBe('nist')
  })
})

describe('certificates and signatures', () => {
  test('NIST pulse 2/1921596 verifies against its 4096-bit certificate (DER-hashed id)', async () => {
    const p = parseStrictPulse(await pulse('nist-2-1921596.json'), 'test')
    const key = await importPulseCertificate(
      await pem('nist-cert-528943a555f5f8ca.pem'),
      p.certificateId,
      'test',
    )
    await checkPulseSignature(p, key, 'test')
  })

  test('NQSN pulse verifies against its certificate (PEM-text-hashed id)', async () => {
    const p = parseStrictPulse(await pulse('nqsn-1-593768.json'), 'test')
    const key = await importPulseCertificate(
      await pem('nqsn-cert-a0b3337b34f96a65.pem'),
      p.certificateId,
      'test',
    )
    await checkPulseSignature(p, key, 'test')
  })

  test('current NIST pulses carry 512-byte signatures that cannot match their 2048-bit certificate', async () => {
    const p = parseStrictPulse(await pulse('nist-2-1945335.json'), 'test')
    const key = await importPulseCertificate(
      await pem('nist-cert-87f27f431da3f584.pem'),
      p.certificateId,
      'test',
    )
    const err = (await checkPulseSignature(p, key, 'nist').catch((e) => e)) as EntropyError
    expect(err.code).toBe('verification')
    expect(err.message).toContain('512-byte signature')
    expect(err.message).toContain('2048-bit')
  })

  test('a certificate that does not hash to the certificateId is rejected', async () => {
    const p = parseStrictPulse(await pulse('nist-2-1921596.json'), 'test')
    const err = (await importPulseCertificate(
      await pem('nqsn-cert-a0b3337b34f96a65.pem'),
      p.certificateId,
      'test',
    ).catch((e) => e)) as EntropyError
    expect(err.code).toBe('verification')
    expect(err.message).toContain('does not hash')
  })

  test('a signature from another pulse does not verify', async () => {
    const good = await pulse('nist-2-1921596.json')
    const other = await pulse('nqsn-1-593768.json')
    const p = parseStrictPulse({ ...good, signatureValue: other.signatureValue }, 'test')
    const key = await importPulseCertificate(
      await pem('nist-cert-528943a555f5f8ca.pem'),
      p.certificateId,
      'test',
    )
    const err = (await checkPulseSignature(p, key, 'test').catch((e) => e)) as EntropyError
    expect(err.code).toBe('verification')
  })
})

describe('checkPulseLinkage', () => {
  test('consecutive live pulses link (previous value and precommitment)', async () => {
    const earlier = parseStrictPulse(await pulse('nist-2-1945334.json'), 'test')
    const later = parseStrictPulse(await pulse('nist-2-1945335.json'), 'test')
    await checkPulseLinkage(later, earlier, 'test')
  })

  test('a broken precommitment is rejected unless the later pulse flags status bit 1', async () => {
    const earlierRaw = await pulse('nist-2-1945334.json')
    const later = parseStrictPulse(await pulse('nist-2-1945335.json'), 'test')
    const earlier = parseStrictPulse({ ...earlierRaw, precommitmentValue: '00'.repeat(64) }, 'test')
    const err = (await checkPulseLinkage(later, earlier, 'test').catch((e) => e)) as EntropyError
    expect(err.code).toBe('verification')
    expect(err.message).toContain('precommitment')
    await checkPulseLinkage({ ...later, statusCode: 1 }, earlier, 'test')
  })

  test('a previous value that does not match is rejected', async () => {
    const earlier = parseStrictPulse(await pulse('nist-2-1921596.json'), 'test')
    const later = parseStrictPulse(await pulse('nist-2-1945335.json'), 'test')
    const err = (await checkPulseLinkage(later, earlier, 'test').catch((e) => e)) as EntropyError
    expect(err.code).toBe('verification')
    expect(err.message).toContain('previous')
  })
})

describe('parseStrictPulse', () => {
  test('rejects pulses missing serialized fields with bad_response', async () => {
    const raw = await pulse('nist-2-1921596.json')
    for (const broken of [
      { ...raw, uri: undefined },
      { ...raw, chainIndex: -1 },
      { ...raw, localRandomValue: 'xyz' },
      { ...raw, listValues: [] },
      { ...raw, external: null },
    ]) {
      const err = (() => {
        try {
          parseStrictPulse(broken, 'test')
          return null
        } catch (error) {
          return error as EntropyError
        }
      })()
      expect(err?.code).toBe('bad_response')
    }
  })
})
