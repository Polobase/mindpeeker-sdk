import { describe, expect, test } from 'bun:test'
import { EntropyError } from '../../src/errors.js'
import type { EntropyKind, EntropyPrivacy, EntropyProvider } from '../../src/types.js'

export interface ContractExpectations {
  kind: EntropyKind
  privacy: EntropyPrivacy
  /**
   * Byte counts to request; include one that forces the provider to chunk
   * across its per-request cap. Defaults to [1, 16, 33].
   */
  lengths?: number[]
  /** Chunk size to request from stream() in the laziness/multi-chunk check. */
  streamChunkBytes?: number
}

/**
 * Shared behavioral contract every EntropyProvider must satisfy. Run it
 * against each provider (with mocked transport) and against strategy
 * composites — it enforces the "exactly n bytes or throw" invariant, metadata
 * shape, error codes and lazy streaming.
 */
export function providerContract(
  label: string,
  make: () => EntropyProvider,
  expected: ContractExpectations,
): void {
  const lengths = expected.lengths ?? [1, 16, 33]
  const chunkBytes = expected.streamChunkBytes ?? 8

  describe(`contract: ${label}`, () => {
    test('exposes name, kind and privacy metadata', () => {
      const p = make()
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.kind).toBe(expected.kind)
      expect(p.privacy).toBe(expected.privacy)
    })

    test('returns exactly the requested number of bytes', async () => {
      const p = make()
      for (const n of lengths) {
        const { bytes } = await p.getBytes(n)
        expect(bytes).toBeInstanceOf(Uint8Array)
        expect(bytes.length).toBe(n)
      }
    })

    test('attributes results to at least one well-formed source', async () => {
      const p = make()
      const { sources } = await p.getBytes(lengths[0] ?? 1)
      expect(sources.length).toBeGreaterThan(0)
      for (const source of sources) {
        expect(source.name.length).toBeGreaterThan(0)
        expect(['qrng', 'trng', 'beacon', 'csprng', 'mixed']).toContain(source.kind)
        expect(['private', 'public']).toContain(source.privacy)
      }
    })

    test('rejects invalid lengths with invalid_request', async () => {
      const p = make()
      for (const bad of [0, -5, 2.5, Number.NaN]) {
        const err = (await p.getBytes(bad).catch((e) => e)) as EntropyError
        expect(err).toBeInstanceOf(EntropyError)
        expect(err.code).toBe('invalid_request')
      }
    })

    test('rejects a pre-aborted signal with aborted', async () => {
      const p = make()
      const err = (await p
        .getBytes(lengths[0] ?? 1, { signal: AbortSignal.abort() })
        .catch((e) => e)) as EntropyError
      expect(err).toBeInstanceOf(EntropyError)
      expect(err.code).toBe('aborted')
    })

    test('stream is lazy and yields at least two chunks, stopping cleanly', async () => {
      const p = make()
      const stream = p.stream({ chunkBytes })
      const chunks: Uint8Array[] = []
      for await (const chunk of stream) {
        expect(chunk).toBeInstanceOf(Uint8Array)
        expect(chunk.length).toBeGreaterThan(0)
        chunks.push(chunk)
        if (chunks.length === 2) break
      }
      expect(chunks).toHaveLength(2)
    })
  })
}
