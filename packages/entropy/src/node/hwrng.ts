import { createReadStream } from 'node:fs'
import { EntropyError } from '../errors.js'
import type { ConditioningOptions } from '../internal/condition.js'
import { sampledProvider } from '../internal/sampled.js'
import type { EntropyProvider } from '../types.js'

export interface HwRngOptions extends ConditioningOptions {
  /** Default /dev/hwrng — whatever hardware RNG the kernel trusts. */
  path?: string
}

/**
 * The kernel's hardware RNG character device (Linux/Raspberry Pi; also how a
 * plugged-in ChaosKey surfaces). Usually root-only by default.
 */
export function hwRng(opts: HwRngOptions = {}): EntropyProvider {
  const { path = '/dev/hwrng' } = opts

  async function* open(): AsyncGenerator<Uint8Array> {
    const stream = createReadStream(path, { highWaterMark: 4096 })
    try {
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        yield new Uint8Array(chunk)
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EACCES' || code === 'EPERM') {
        throw new EntropyError(
          'network',
          `${path} is usually root-only — run with sufficient privileges or adjust the device permissions`,
          { provider: 'hwrng', cause: error },
        )
      }
      if (code === 'ENOENT') {
        throw new EntropyError(
          'network',
          `${path} does not exist — this system exposes no kernel hardware RNG`,
          { provider: 'hwrng', cause: error },
        )
      }
      throw new EntropyError('network', `failed reading ${path}: ${(error as Error).message}`, {
        provider: 'hwrng',
        cause: error,
      })
    } finally {
      stream.destroy()
    }
  }

  return sampledProvider(
    {
      name: 'hwrng',
      kind: 'trng',
      privacy: 'private',
      open,
      defaultMinEntropyPerSample: 7,
      defaultSafetyFactor: 2,
    },
    opts,
  )
}
