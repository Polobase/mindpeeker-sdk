// The universal client-side entropy source for every demo: the runtime's
// Web-Crypto CSPRNG, wrapped as a mindpeeker entropy provider. No server —
// `crypto.getRandomValues` runs in the browser. Consumers that accept a
// `ByteSource`/`OracleInput` can take `stream()` directly.

import { cryptoProvider } from '@mindpeeker/entropy/providers'

export const provider = cryptoProvider()

/** Resolve exactly `n` fresh random bytes. */
export async function getBytes(n: number): Promise<Uint8Array> {
  const { bytes } = await provider.getBytes(n)
  return bytes
}

/** A lazy `AsyncIterable<Uint8Array>` of CSPRNG bytes (default poll stream). */
export function stream(opts?: { chunkBytes?: number; signal?: AbortSignal }) {
  return provider.stream(opts)
}
