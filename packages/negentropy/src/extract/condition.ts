import { NegentropyError } from '../errors.js'
import { closeIterator, nextOrAbort } from '../internal/abort.js'

function requireBytes(value: unknown, name: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new NegentropyError('invalid_config', `${name} must be a Uint8Array`)
  }
}

/** SHA-256 conditioning (SP 800-90B vetted component). 32 bytes out. Non-Uint8Array input throws `invalid_config`. */
export async function sha256Condition(input: Uint8Array): Promise<Uint8Array> {
  requireBytes(input, 'sha256Condition input')
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input as BufferSource))
}

/**
 * HMAC-SHA-256 conditioning (SP 800-90B vetted component). 32 bytes out. The
 * key must be a non-empty Uint8Array (`invalid_config` — WebCrypto rejects an
 * empty HMAC key with an untyped DOMException).
 */
export async function hmacCondition(key: Uint8Array, input: Uint8Array): Promise<Uint8Array> {
  requireBytes(key, 'hmac key')
  if (key.length === 0) {
    throw new NegentropyError('invalid_config', 'hmac key must not be empty')
  }
  requireBytes(input, 'hmacCondition input')
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
  /**
   * Pool ⌈safetyFactor·256/h⌉ raw bytes per 32-byte output block (≥ 1, default
   * 2). The block's credit is SP 800-90B Output_Entropy — see `conditionStream`.
   */
  safetyFactor?: number
  mode?: 'sha256' | 'hmac'
  /** Required (non-empty) for 'hmac'. */
  key?: Uint8Array
  /** Aborts a pending pull immediately; pass the same signal to the upstream source. */
  signal?: AbortSignal
}

/**
 * Streaming conditioner: pools raw bytes into blocks of
 * n = ⌈safetyFactor·256/h⌉ bytes and emits SHA-256 (or HMAC-SHA-256) of each —
 * one 32-byte block per n raw bytes, in order, independent of how the input
 * is chunked. Lazy and pull-based; pooling is linear-time (whole blocks are
 * hashed as views into the incoming chunk, only the carried fragment is
 * copied). A trailing under-filled pool is dropped, never emitted — no
 * partial-credit output. Health testing is deliberately separate
 * (`ContinuousHealth`) so raw analysis and conditioning compose.
 *
 * Per-block credit (what a downstream claim may assume) is SP 800-90B
 * §3.1.5.1.2 `vettedOutputEntropy(h·n, 256, 8·n)` =
 * min(Output_Entropy(8n, 256, 256, h·n), 0.999·256), never a full 256 bits:
 * safetyFactor 2 at h = 8 → 64 bytes → 255.744 bits (the 0.999 cap);
 * safetyFactor 1 at h = 8 → 32 bytes → 251.69 bits (the ω multicollision
 * term); safetyFactor 1 at h = 4 → 64 bytes → 255.0 bits (the ψ term).
 *
 * Errors: bad options → `invalid_config` (on the first pull); a non-Uint8Array
 * chunk → `invalid_config`; an upstream error → `source_failed` (cause kept);
 * abort → `aborted`, raced against a pending pull so a blocked upstream
 * cannot delay it, and also when the upstream ends cleanly after the abort.
 * The upstream iterator is closed (`return()`) on abort, error, or early exit
 * (waiting at most 100 ms after an abort).
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
  if (!(safetyFactor >= 1 && Number.isFinite(safetyFactor))) {
    throw new NegentropyError(
      'invalid_config',
      `safetyFactor must be a finite number ≥ 1, got ${safetyFactor}`,
    )
  }
  if (mode !== 'sha256' && mode !== 'hmac') {
    throw new NegentropyError('invalid_config', `mode must be sha256|hmac, got ${String(mode)}`)
  }
  if (mode === 'hmac') {
    if (!(key instanceof Uint8Array) || key.length === 0) {
      throw new NegentropyError('invalid_config', 'hmac conditioning requires a non-empty key')
    }
  }
  if (raw === null || typeof raw !== 'object' || !(Symbol.asyncIterator in raw)) {
    throw new NegentropyError('invalid_config', 'conditionStream input must be an AsyncIterable')
  }
  const abortError = () => new NegentropyError('aborted', 'condition stream aborted')
  if (signal?.aborted) throw abortError()

  const bytesPerBlock = Math.ceil((safetyFactor * 256) / minEntropyPerByte)
  const digest = (block: Uint8Array) =>
    mode === 'hmac' ? hmacCondition(key as Uint8Array, block) : sha256Condition(block)

  const carry = new Uint8Array(bytesPerBlock) // the unfinished block
  let carried = 0
  const iterator = raw[Symbol.asyncIterator]()
  let exhausted = false
  try {
    while (true) {
      const step = await nextOrAbort(iterator, signal, abortError)
      if (step.done) {
        exhausted = true
        if (signal?.aborted) throw abortError()
        return
      }
      const chunk: unknown = step.value
      if (!(chunk instanceof Uint8Array)) {
        throw new NegentropyError('invalid_config', 'conditionStream chunks must be Uint8Array')
      }
      let offset = 0
      if (carried > 0) {
        const take = Math.min(bytesPerBlock - carried, chunk.length)
        carry.set(chunk.subarray(0, take), carried)
        carried += take
        offset = take
        if (carried < bytesPerBlock) continue
        carried = 0
        yield await digest(carry)
        if (signal?.aborted) throw abortError()
      }
      // whole blocks straight from the chunk: digest is awaited before the next pull
      while (chunk.length - offset >= bytesPerBlock) {
        const block = chunk.subarray(offset, offset + bytesPerBlock)
        offset += bytesPerBlock
        yield await digest(block)
        if (signal?.aborted) throw abortError()
      }
      carry.set(chunk.subarray(offset), 0) // copy: the source may reuse its buffer
      carried = chunk.length - offset
    }
  } catch (error) {
    if (error instanceof NegentropyError) throw error
    if (signal?.aborted)
      throw new NegentropyError('aborted', 'condition stream aborted', { cause: error })
    throw new NegentropyError('source_failed', 'conditionStream upstream failed', { cause: error })
  } finally {
    if (!exhausted) await closeIterator(iterator, signal?.aborted === true)
  }
}
