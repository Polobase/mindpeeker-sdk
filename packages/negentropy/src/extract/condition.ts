import { NegentropyError } from '../errors.js'
import { concatBytes } from '../internal/bytes.js'

/** SHA-256 conditioning (SP 800-90B vetted component). 32 bytes out. */
export async function sha256Condition(input: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input as BufferSource))
}

/** HMAC-SHA-256 conditioning (SP 800-90B vetted component). 32 bytes out. */
export async function hmacCondition(key: Uint8Array, input: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, input as BufferSource))
}

export interface ConditionStreamOptions {
  /** Assessed min-entropy of the raw input, bits per byte (0 < h ≤ 8). */
  minEntropyPerByte: number
  /** Pool safetyFactor × 256 credited bits per 32-byte output block. Default 2. */
  safetyFactor?: number
  mode?: 'sha256' | 'hmac'
  /** Required for 'hmac'. */
  key?: Uint8Array
  signal?: AbortSignal
}

/**
 * Streaming conditioner: pools raw bytes until the credited min-entropy
 * reaches safetyFactor × 256 bits, then emits one 32-byte conditioned block.
 * Lazy and pull-based. A trailing under-filled pool is dropped, never
 * emitted — no partial-credit output. Health testing is deliberately
 * separate (`ContinuousHealth`) so raw analysis and conditioning compose.
 */
export async function* conditionStream(
  raw: AsyncIterable<Uint8Array>,
  opts: ConditionStreamOptions,
): AsyncGenerator<Uint8Array> {
  const { minEntropyPerByte, mode = 'sha256', key, signal } = opts
  const safetyFactor = opts.safetyFactor ?? 2
  if (!(minEntropyPerByte > 0 && minEntropyPerByte <= 8)) {
    throw new NegentropyError(
      'invalid_config',
      `minEntropyPerByte must be in (0, 8], got ${minEntropyPerByte}`,
    )
  }
  if (!(safetyFactor >= 1)) {
    throw new NegentropyError('invalid_config', `safetyFactor must be ≥ 1, got ${safetyFactor}`)
  }
  if (mode === 'hmac' && !key) {
    throw new NegentropyError('invalid_config', 'hmac conditioning requires a key')
  }
  const bytesPerBlock = Math.ceil((safetyFactor * 256) / minEntropyPerByte)
  const digest = (block: Uint8Array) =>
    mode === 'hmac' ? hmacCondition(key as Uint8Array, block) : sha256Condition(block)

  let pool: Uint8Array[] = []
  let pooled = 0
  for await (const chunk of raw) {
    if (signal?.aborted) throw new NegentropyError('aborted', 'condition stream aborted')
    pool.push(chunk)
    pooled += chunk.length
    while (pooled >= bytesPerBlock) {
      const all = concatBytes(pool)
      const block = all.slice(0, bytesPerBlock)
      const rest = all.slice(bytesPerBlock)
      pool = rest.length > 0 ? [rest] : []
      pooled = rest.length
      yield await digest(block)
    }
  }
}
