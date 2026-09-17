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
 * Read size per chunk. Small on purpose: a blocking /dev/hwrng read must fill
 * the whole request before it returns, and a slow device should not have to
 * produce kilobytes before the first 74-byte block can be conditioned.
 */
const READ_CHUNK_BYTES = 256

/** Map an fs error on the hwrng device to a helpful `EntropyError('network')`. */
function deviceError(error: unknown, path: string): EntropyError {
  if (error instanceof EntropyError) return error
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'EACCES' || code === 'EPERM') {
    return new EntropyError(
      'network',
      `${path} is usually root-only — run with sufficient privileges or adjust the device permissions`,
      { provider: 'hwrng', cause: error },
    )
  }
  if (code === 'ENOENT') {
    return new EntropyError(
      'network',
      `${path} does not exist — this system exposes no kernel hardware RNG`,
      { provider: 'hwrng', cause: error },
    )
  }
  return new EntropyError('network', `failed reading ${path}: ${(error as Error)?.message}`, {
    provider: 'hwrng',
    cause: error,
  })
}

/**
 * The kernel's hardware RNG character device (Linux/Raspberry Pi; also how a
 * plugged-in ChaosKey surfaces). Usually root-only by default. The session's
 * signal (timeout or caller abort) destroys the read stream at once; device
 * errors surface as `EntropyError('network')`, an abort as `aborted`.
 */
export function hwRng(opts: HwRngOptions = {}): EntropyProvider {
  const { path = '/dev/hwrng' } = opts

  async function* open(signal?: AbortSignal): AsyncGenerator<Uint8Array> {
    const aborted = () =>
      new EntropyError('aborted', `reading ${path} aborted`, {
        provider: 'hwrng',
        cause: signal?.reason,
      })
    if (signal?.aborted) throw aborted()
    const stream = createReadStream(path, { highWaterMark: READ_CHUNK_BYTES })
    const onAbort = () => {
      stream.destroy()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      for await (const chunk of stream as AsyncIterable<Buffer>) {
        yield new Uint8Array(chunk)
      }
      if (signal?.aborted) throw aborted()
    } catch (error) {
      if (signal?.aborted) throw aborted()
      throw deviceError(error, path)
    } finally {
      signal?.removeEventListener('abort', onAbort)
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
