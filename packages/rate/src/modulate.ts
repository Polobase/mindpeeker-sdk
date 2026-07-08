import { digitToAngle, ratePhases } from './angle.js'
import { RateError } from './errors.js'
import { type ByteInput, type ModulateOptions, type Rate, TAU } from './types.js'

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new RateError('aborted', 'modulation aborted by signal', { cause: signal.reason })
  }
}

/**
 * Normalise any {@link ByteInput} — a finished buffer, a raw async chunk
 * stream, or a live source — into a single async chunk stream, threading the
 * abort signal through to a source's `stream(opts)` when present.
 */
async function* iterateBytes(input: ByteInput, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  throwIfAborted(signal)
  if (input instanceof Uint8Array) {
    yield input
    return
  }
  const maybeSource = input as {
    stream?: (opts?: { signal?: AbortSignal }) => AsyncIterable<Uint8Array>
  }
  const iterable =
    typeof maybeSource.stream === 'function'
      ? maybeSource.stream({ signal })
      : (input as AsyncIterable<Uint8Array>)
  for await (const chunk of iterable) {
    throwIfAborted(signal)
    yield chunk
  }
}

/**
 * Deterministic keystream derived purely from a rate's ring angles.
 *
 * $$\mathrm{mask}[i] = \Big\lfloor \theta\!\left(i \bmod r\right)
 *   \cdot \frac{256}{2\pi} + \tfrac12 \Big\rfloor \bmod 256,
 *   \qquad \theta(k) = \mathrm{digit}_k \cdot \tfrac{2\pi}{b}$$
 *
 * where $r$ is the number of digits. The stream is periodic with period $r$:
 * $\mathrm{mask}[i] = \mathrm{mask}[i + r]$. It is a fixed function of the rate
 * — **not** a cryptographic PRNG and carries no entropy of its own — so it must
 * never be used as a one-time pad or key.
 *
 * @throws {RateError} `invalid_rate` if the rate has no digits.
 */
export function rateMask(rate: Rate, length: number): Uint8Array {
  const r = rate.digits.length
  if (r === 0) throw new RateError('invalid_rate', 'rateMask needs a rate with at least one digit')
  if (!Number.isInteger(length) || length < 0) {
    throw new RateError('invalid_rate', `mask length must be a non-negative integer, got ${length}`)
  }
  const out = new Uint8Array(length)
  const period = new Uint8Array(r)
  for (let k = 0; k < r; k++) {
    const theta = digitToAngle(rate.digits[k] as number, rate.base)
    period[k] = Math.round((theta * 256) / TAU) % 256
  }
  for (let i = 0; i < length; i++) out[i] = period[i % r] as number
  return out
}

/**
 * Phase-modulate a byte stream by a rate. Each byte $b$ becomes the argument
 * of the unit phasor $e^{i\,2\pi b/256}$ **rotated** by the ring phase for its
 * position, cycling through the rate's rings one byte at a time:
 *
 * $$\phi_j = \left(\frac{2\pi b_j}{256} + \theta_{\,j \bmod n}\right)
 *   \bmod 2\pi, \qquad \theta_k = \mathrm{digit}_k \cdot \tfrac{2\pi}{b}$$
 *
 * where $n$ is the number of rings and $j$ the running byte index across all
 * chunks. Each input chunk yields a `Float64Array` of the resulting phases in
 * $[0, 2\pi)$, preserving chunk boundaries. Purely deterministic: identical
 * bytes and rate give identical phases.
 *
 * @throws {RateError} `invalid_rate` for an empty rate; `aborted` on signal.
 */
export async function* phaseModulate(
  input: ByteInput,
  rate: Rate,
  opts: ModulateOptions = {},
): AsyncGenerator<Float64Array> {
  const phases = ratePhases(rate)
  const n = phases.length
  if (n === 0) throw new RateError('invalid_rate', 'phaseModulate needs a rate with digits')
  let j = 0
  for await (const chunk of iterateBytes(input, opts.signal)) {
    const out = new Float64Array(chunk.length)
    for (let k = 0; k < chunk.length; k++) {
      const base = (TAU * (chunk[k] as number)) / 256 + (phases[j % n] as number)
      out[k] = base % TAU
      j++
    }
    yield out
  }
}

/**
 * XOR a byte stream with {@link rateMask}, cycling the mask (period = digit
 * count) across the whole stream:
 *
 * $$\mathrm{out}_j = b_j \oplus \mathrm{mask}[j \bmod r]$$
 *
 * XOR by a fixed value is a bijection on $\{0,\dots,255\}$, so this is
 * **entropy-preserving**: it neither adds nor removes information, and applying
 * `xorImprint` twice with the same rate is the identity. The "imprint" is an
 * esoteric radionic protocol — a reproducible, reversible re-labelling of the
 * bytes by the rate's angles, nothing more. It provides no confidentiality.
 *
 * @throws {RateError} `invalid_rate` for an empty rate; `aborted` on signal.
 */
export async function* xorImprint(
  input: ByteInput,
  rate: Rate,
  opts: ModulateOptions = {},
): AsyncGenerator<Uint8Array> {
  const mask = rateMask(rate, rate.digits.length)
  const r = mask.length
  let j = 0
  for await (const chunk of iterateBytes(input, opts.signal)) {
    const out = new Uint8Array(chunk.length)
    for (let k = 0; k < chunk.length; k++) {
      out[k] = (chunk[k] as number) ^ (mask[j % r] as number)
      j++
    }
    yield out
  }
}
