import type { ByteSource, ByteStreamOptions } from '../../src/types.js'

/** Deterministic xorshift32 byte stream (the SDK-wide seeded-test idiom). */
export function prngBytes(n: number, seed = 0xabcdef01): Uint8Array {
  let state = seed
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    out[i] = state & 0xff
  }
  return out
}

/** Deterministic uniforms in (0, 1). */
export function prngUniforms(n: number, seed = 0xabcdef01): Float64Array {
  let state = seed
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    out[i] = (state + 0.5) / 4_294_967_296
  }
  return out
}

/** Deterministic iid symbols uniform on [0, alphabet). */
export function prngSymbols(n: number, alphabet: number, seed = 0xabcdef01): Int32Array {
  const uniforms = prngUniforms(n, seed)
  const out = new Int32Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.floor((uniforms[i] as number) * alphabet)
  return out
}

/** Deterministic iid bits. */
export function prngBits(n: number, seed = 0xabcdef01): Int32Array {
  return prngSymbols(n, 2, seed)
}

/** Wrap values in a plain async iterable, one item per pull. */
export async function* asyncValues<T>(values: Iterable<T>): AsyncGenerator<T> {
  for (const value of values) yield value
}

/** Endless seeded byte source with pull accounting, for laziness assertions. */
export function countingByteSource(
  name: string,
  chunkBytes = 25,
  seed = 0xabcdef01,
): ByteSource & { readonly pulls: number } {
  let pulls = 0
  let round = seed
  return {
    name,
    get pulls() {
      return pulls
    },
    stream(_opts?: ByteStreamOptions) {
      return (async function* () {
        while (true) {
          pulls++
          yield prngBytes(chunkBytes, round++)
        }
      })()
    },
  }
}

/** Drain an async generator into an array. */
export async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = []
  for await (const item of gen) out.push(item)
  return out
}

/**
 * The exact-TE construction: x tiles the de Bruijn cycle "0011" M times plus
 * one trailing 0; y is x delayed by one step with y[0] = 1. Every consecutive
 * (y_t, y_{t+1}) pair then occurs exactly M times across the estimator's
 * tuple range, so plug-in TE(x→y, k=1, l=1) is EXACTLY 1 bit.
 */
export function balancedShiftPair(m: number): { x: Int32Array; y: Int32Array } {
  const n = 4 * m + 1
  const x = new Int32Array(n)
  for (let i = 0; i < 4 * m; i++) x[i] = i % 4 < 2 ? 0 : 1
  x[n - 1] = 0
  const y = new Int32Array(n)
  y[0] = 1
  for (let t = 1; t < n; t++) y[t] = x[t - 1] as number
  return { x, y }
}

/**
 * A live source that honours the forwarded signal the way `@mindpeeker/entropy`
 * providers do: every pull waits `delayMs`, and an abort rejects the pending
 * pull with `signal.reason` (a DOMException AbortError by default).
 */
export function signalHonouringSource(
  name: string,
  delayMs = 5,
  chunkBytes = 4,
): ByteSource & { readonly closed: boolean } {
  let closed = false
  return {
    name,
    get closed() {
      return closed
    },
    stream(opts?: ByteStreamOptions) {
      const signal = opts?.signal
      return (async function* () {
        let round = 1
        try {
          while (true) {
            await new Promise<void>((resolve, reject) => {
              if (signal?.aborted) {
                reject(signal.reason)
                return
              }
              const timer = setTimeout(() => {
                signal?.removeEventListener('abort', onAbort)
                resolve()
              }, delayMs)
              const onAbort = () => {
                clearTimeout(timer)
                reject(signal?.reason)
              }
              signal?.addEventListener('abort', onAbort, { once: true })
            })
            yield prngBytes(chunkBytes, round++)
          }
        } finally {
          closed = true
        }
      })()
    },
  }
}

/** A source that yields one chunk and then never resolves again (ignores the signal). */
export function stalledSource(name: string): ByteSource {
  return {
    name,
    stream() {
      return (async function* () {
        yield Uint8Array.of(1, 2, 3)
        await new Promise<never>(() => {})
      })()
    },
  }
}

/** A source that simply ends (returns) once its signal is aborted. */
export function returningSource(name: string, delayMs = 5): ByteSource {
  return {
    name,
    stream(opts?: ByteStreamOptions) {
      const signal = opts?.signal
      return (async function* () {
        let round = 7
        while (true) {
          await new Promise<void>((resolve) => {
            const timer = setTimeout(done, delayMs)
            function done() {
              clearTimeout(timer)
              signal?.removeEventListener('abort', done)
              resolve()
            }
            signal?.addEventListener('abort', done, { once: true })
          })
          if (signal?.aborted) return
          yield prngBytes(4, round++)
        }
      })()
    },
  }
}

/** A source whose stream fails with `error` after `chunks` good chunks. */
export function failingSource(name: string, error: unknown, chunks = 1): ByteSource {
  return {
    name,
    stream() {
      return (async function* () {
        for (let i = 0; i < chunks; i++) yield prngBytes(4, i + 1)
        throw error
      })()
    },
  }
}

/** Resolve after `ms` milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** y copies x's bit from `lag` steps back with probability `coupling`, else iid bits. */
export function coupledPair(
  n: number,
  coupling: number,
  seed: number,
  lag = 1,
): { x: Int32Array; y: Int32Array } {
  const x = prngBits(n, seed)
  const u = prngUniforms(2 * n, seed ^ 0x5f5f5f5f)
  const y = new Int32Array(n)
  for (let t = lag; t < n; t++) {
    y[t] =
      (u[2 * t] as number) < coupling
        ? (x[t - lag] as number)
        : (u[2 * t + 1] as number) < 0.5
          ? 0
          : 1
  }
  return { x, y }
}
