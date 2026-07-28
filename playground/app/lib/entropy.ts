// Client-only entropy providers (imports @mindpeeker/*, which resolves via the
// Vite source aliases — client build only). Imported exclusively by *.client.vue
// components so nitro never bundles it server-side.

import type { EntropyProvider } from '@mindpeeker/entropy'
import { fallback } from '@mindpeeker/entropy'
import { anuLegacy, cryptoProvider, curby, drand, jitterEntropy } from '@mindpeeker/entropy/providers'
import { currentSourceId } from '~/utils/sources'

const MAKE: Record<string, () => EntropyProvider> = {
  jitter: () => jitterEntropy({ allowCoarseClock: true }),
  drand: () => drand(),
  curby: () => curby(),
  anu: () => anuLegacy(),
}

const local = cryptoProvider()

function build(): EntropyProvider {
  const make = MAKE[currentSourceId()]
  if (!make) return local
  return fallback([make(), local], { attemptTimeoutMs: 3500 })
}

export const provider = build()

export async function getBytes(n: number): Promise<Uint8Array> {
  return (await provider.getBytes(n)).bytes
}

export async function localBytes(n: number): Promise<Uint8Array> {
  return (await local.getBytes(n)).bytes
}
