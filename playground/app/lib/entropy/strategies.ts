// fallback / xorMix / race, each demonstrated with a member that is meant to
// fail. CLIENT-ONLY (it imports @mindpeeker/entropy).

import {
  defineProvider,
  EntropyError,
  type EntropyProvider,
  type EntropySourceAttribution,
  fallback,
  race,
  xorMix,
} from '@mindpeeker/entropy'
import { cryptoProvider, drand } from '@mindpeeker/entropy/providers'
import { drbgSource, localBytes } from '~/lib/entropy'
import { errorInfo } from '~/lib/errors'
import { toHex } from '~/lib/format'

/** A provider that always fails, built with the public `defineProvider` API. */
export function failingProvider(name = 'always-down'): EntropyProvider {
  return defineProvider({
    name,
    kind: 'qrng',
    privacy: 'private',
    async getBytes() {
      throw new EntropyError('network', `${name}: simulated outage (HTTP 503)`, { provider: name })
    },
  })
}

/** A provider that answers correctly, but late. */
export function slowProvider(ms: number, name = `slow-qrng(${ms}ms)`): EntropyProvider {
  return defineProvider({
    name,
    kind: 'qrng',
    privacy: 'private',
    async getBytes(n, opts) {
      await delay(ms, opts?.signal)
      return {
        bytes: await localBytes(n, opts?.signal ? { signal: opts.signal } : {}),
        sources: [{ name, kind: 'qrng', privacy: 'private' }],
      }
    },
  })
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new EntropyError('aborted', 'request aborted', { provider: 'slow-qrng' }))
      },
      { once: true },
    )
  })
}

export type StrategyId =
  | 'fallback'
  | 'fallback-exhausted'
  | 'xor'
  | 'xor-identical'
  | 'xor-identical-short'
  | 'race'

export interface StrategyDemo {
  readonly id: StrategyId
  readonly title: string
  readonly description: string
  readonly code: string
  readonly bytes: number
  readonly expect: string
  readonly make: () => EntropyProvider
}

export const STRATEGY_DEMOS: readonly StrategyDemo[] = [
  {
    id: 'fallback',
    title: 'fallback — first success wins',
    description:
      'A quantum member that is down, then the local CSPRNG. Attribution names who actually served.',
    code: `import { fallback } from '@mindpeeker/entropy'
import { cryptoProvider } from '@mindpeeker/entropy/providers'

const chain = fallback([failingProvider('always-down'), cryptoProvider()])
const { bytes, sources } = await chain.getBytes(32)
sources.map((s) => s.name) // ['crypto']`,
    bytes: 32,
    expect: "serves 32 bytes, sources = ['crypto']",
    make: () => fallback([failingProvider(), cryptoProvider()]),
  },
  {
    id: 'fallback-exhausted',
    title: 'fallback — every member down',
    description:
      'When the chain is exhausted you get insufficient_entropy, whose cause is an AggregateError holding each member’s error in attempt order.',
    code: `const chain = fallback([failingProvider('down-a'), failingProvider('down-b')])
await chain.getBytes(32)
// EntropyError('insufficient_entropy'), cause: AggregateError [EntropyError, EntropyError]`,
    bytes: 32,
    expect: "fails with insufficient_entropy and two member errors",
    make: () => fallback([failingProvider('down-a'), failingProvider('down-b')]),
  },
  {
    id: 'xor',
    title: 'xorMix — as strong as the strongest member',
    description:
      'XOR of independent sources. It fails closed: if any member fails, the call fails — wrap it in fallback to degrade.',
    code: `import { xorMix } from '@mindpeeker/entropy'

const belt = xorMix([drbgSource('mix member A'), cryptoProvider()])
const { bytes, sources } = await belt.getBytes(32) // sources lists BOTH members`,
    bytes: 32,
    expect: 'serves 32 bytes, sources lists both members',
    make: () => xorMix([drbgSource('entropy page / mix member A'), cryptoProvider()]),
  },
  {
    id: 'xor-identical',
    title: 'xorMix — the identical-member guard',
    description:
      'Two DRBGs on the same seed return byte-identical results, which would XOR to zeros. At 8 bytes or more that is caught as bad_response (0.2.0).',
    code: `const same = () => drbgProvider({ seed })          // the SAME seed twice
await xorMix([same(), same()]).getBytes(16)
// EntropyError('bad_response'): members returned identical bytes`,
    bytes: 16,
    expect: 'fails with bad_response',
    make: () =>
      xorMix([drbgSource('entropy page / identical'), drbgSource('entropy page / identical')]),
  },
  {
    id: 'xor-identical-short',
    title: 'xorMix — and where the guard cannot help',
    description:
      'Below 8 bytes independent sources collide too often to tell, so the same degenerate mix is accepted — and XORs to zeros. Never feed the same upstream in twice.',
    code: `await xorMix([same(), same()]).getBytes(4)
// resolves: 00 00 00 00 — the guard only applies from 8 bytes up`,
    bytes: 4,
    expect: 'resolves with 00 00 00 00',
    make: () =>
      xorMix([drbgSource('entropy page / identical'), drbgSource('entropy page / identical')]),
  },
  {
    id: 'race',
    title: 'race — fastest response wins',
    description:
      'Every member starts at once, the first result wins and the losers are aborted. Latency-critical, not quality-critical.',
    code: `import { race } from '@mindpeeker/entropy'

const fast = race([slowProvider(900), cryptoProvider()])
const { bytes, sources } = await fast.getBytes(32) // ['crypto'] — it answered first`,
    bytes: 32,
    expect: "crypto wins in a few ms, sources = ['crypto']",
    make: () => race([slowProvider(900), cryptoProvider()]),
  },
]

export interface StrategyOutcome {
  readonly id: StrategyId
  readonly ok: boolean
  readonly providerName: string
  readonly kind: string
  readonly privacy: string
  readonly ms: number
  readonly hex?: string
  readonly allZero?: boolean
  readonly sources?: readonly EntropySourceAttribution[]
  readonly code?: string
  readonly message?: string
  /** One line per member error inside an AggregateError cause. */
  readonly causes?: readonly string[]
}

export async function runStrategy(
  demo: StrategyDemo,
  signal?: AbortSignal,
): Promise<StrategyOutcome> {
  const provider = demo.make()
  const started = performance.now()
  try {
    const result = await provider.getBytes(demo.bytes, { signal, timeoutMs: 15_000 })
    return {
      id: demo.id,
      ok: true,
      providerName: provider.name,
      kind: provider.kind,
      privacy: provider.privacy,
      ms: performance.now() - started,
      hex: toHex(result.bytes, { sep: ' ' }),
      allZero: result.bytes.every((b) => b === 0),
      sources: result.sources,
    }
  } catch (error) {
    const info = errorInfo(error)
    const cause = (error as { cause?: unknown }).cause
    const causes =
      cause instanceof AggregateError
        ? cause.errors.map((e: unknown) => errorInfo(e)).map((i) => `${i.name} (${i.code}): ${i.message}`)
        : undefined
    return {
      id: demo.id,
      ok: false,
      providerName: provider.name,
      kind: provider.kind,
      privacy: provider.privacy,
      ms: performance.now() - started,
      code: info.code ?? info.name,
      message: info.message,
      ...(causes ? { causes } : {}),
    }
  }
}

export interface PrivacyRow {
  readonly expression: string
  readonly name: string
  readonly kind: string
  readonly privacy: string
  readonly rule: string
}

/**
 * The privacy/kind algebra, read off real composites — no network call is
 * made, only the objects are constructed.
 */
export function privacyAlgebra(): PrivacyRow[] {
  const rows: [string, EntropyProvider, string][] = [
    [
      'fallback([drand(), cryptoProvider()])',
      fallback([drand(), cryptoProvider()]),
      'pessimistic: any member might serve, so one public member makes it public',
    ],
    [
      'race([drand(), cryptoProvider()])',
      race([drand(), cryptoProvider()]),
      'pessimistic, same reason',
    ],
    [
      'xorMix([drand(), cryptoProvider()])',
      xorMix([drand(), cryptoProvider()]),
      'XOR with one independent private member is private — the beacon adds auditability, not exposure',
    ],
    [
      'xorMix([cryptoProvider(), cryptoProvider()])',
      xorMix([cryptoProvider(), cryptoProvider()]),
      'all members share a kind, so the composite keeps it',
    ],
    [
      'fallback([xorMix([drand(), cryptoProvider()]), cryptoProvider()])',
      fallback([xorMix([drand(), cryptoProvider()]), cryptoProvider()]),
      'strategies nest: auditable-but-private, and never fails',
    ],
  ]
  return rows.map(([expression, provider, rule]) => ({
    expression,
    name: provider.name,
    kind: provider.kind,
    privacy: provider.privacy,
    rule,
  }))
}
