/**
 * Shared command line of the cookbook recipes (docs/cookbook.md).
 *
 *   --source <name>   entropy for the recipe (default: offline)
 *   --control <name>  a second, independent source where a recipe needs one (default: offline)
 *   --live            fetch public beacon rounds over the network instead of the recorded fixture
 *   --smoke           tiny sizes; used by examples/test/smoke.test.ts
 *
 * `offline` is HMAC_DRBG (SP 800-90A) over a fixed seed printed in this file, so every
 * offline run reproduces byte for byte. It is a deterministic control, never a secret.
 */
import type { EntropyProvider } from '@mindpeeker/entropy'
import {
  anuLegacy,
  cryptoProvider,
  curby,
  drand,
  drbgProvider,
  nqsn,
  padova,
  qrandomIo,
} from '@mindpeeker/entropy/providers'

export interface RecipeArgs {
  readonly source: string
  readonly control: string
  readonly live: boolean
  readonly smoke: boolean
}

export const SOURCE_NAMES = [
  'offline',
  'crypto',
  'drand',
  'curby',
  'nqsn',
  'anu-legacy',
  'qrandom-io',
  'padova',
] as const

const PUBLIC_BEACONS = new Set(['drand', 'curby', 'nqsn'])
const opened = new Set<string>()

function sourceName(value: string | undefined, flag: string): string {
  if (value === undefined || !(SOURCE_NAMES as readonly string[]).includes(value)) {
    throw new Error(`${flag} must be one of ${SOURCE_NAMES.join(', ')}; got ${String(value)}`)
  }
  return value
}

/** Parse the shared flags; unknown flags are an error, not silently ignored. */
export function parseArgs(argv: readonly string[] = process.argv.slice(2)): RecipeArgs {
  let source = 'offline'
  let control = 'offline'
  let live = false
  let smoke = false
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = (argv[i] ?? '').split('=', 2)
    const value = () => inline ?? argv[++i]
    if (flag === '--source') source = sourceName(value(), '--source')
    else if (flag === '--control') control = sourceName(value(), '--control')
    else if (flag === '--live') live = true
    else if (flag === '--smoke') smoke = true
    else
      throw new Error(`unknown argument ${argv[i]} (flags: --source, --control, --live, --smoke)`)
  }
  return { source, control, live, smoke }
}

/**
 * Open a named source for one role in a recipe. The provider is renamed to
 * `<label>=<provider name>` so several roles stay distinct in recordings. Offline
 * roles get independent DRBG streams (the label is part of the seed). A public
 * beacon can serve only one role: two instances would return identical bytes.
 */
export function openSource(name: string, label: string): EntropyProvider {
  if (PUBLIC_BEACONS.has(name)) {
    if (opened.has(name)) throw new Error(`${name} is public: two roles would be identical streams`)
    opened.add(name)
  }
  const seed = new TextEncoder().encode(`mindpeeker cookbook offline seed v1 / ${label}`)
  const providers: Record<string, () => EntropyProvider> = {
    offline: () => drbgProvider({ seed }),
    crypto: () => cryptoProvider(),
    drand: () => drand(),
    curby: () => curby(),
    nqsn: () => nqsn(),
    'anu-legacy': () => anuLegacy(),
    'qrandom-io': () => qrandomIo(),
    padova: () => padova(),
  }
  const provider = (providers[sourceName(name, 'source')] as () => EntropyProvider)()
  return Object.freeze({ ...provider, name: `${label}=${provider.name}` })
}

/** Full size for a real run, a small one under --smoke. */
export function size(args: RecipeArgs, full: number, smoke: number): number {
  return args.smoke ? smoke : full
}

/** Compact number formatting for the printed reports. */
export function fmt(value: number, digits = 4): string {
  if (Number.isInteger(value)) return String(value)
  return Math.abs(value) < 1e-3 && value !== 0 ? value.toExponential(2) : value.toFixed(digits)
}
