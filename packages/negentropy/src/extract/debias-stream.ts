import { NegentropyError } from '../errors.js'
import { closeIterator, nextOrAbort } from '../internal/abort.js'

/** Streaming debiaser: 'von-neumann' (pairs, odd bit carried) or 'peres' (Zhou–Bruck random-stream algorithm). */
export type DebiasMethod = 'von-neumann' | 'peres'

export interface DebiasStreamOptions {
  /**
   * 'peres' only: maximum depth of the random-stream status tree, an integer
   * in [1, 32]. Default 16 — within ~0.1% of the unbounded rate on 10⁶ bits
   * (0.979 bits/bit at p = ½, 0.863 at p = 0.7). Memory is at most
   * 2^maxDepth − 1 nodes.
   */
  maxDepth?: number
  /** Aborts a pending pull immediately; pass the same signal to the upstream source. */
  signal?: AbortSignal
}

/** A synchronous bit-level debiaser with state carried across calls. */
export interface BitDebiaser {
  /** Feed one input bit (0/1); returns nothing — outputs accumulate until `take()`. */
  push(bit: number): void
  /** Remove and return the output bits produced so far, in order. */
  take(): number[]
}

interface StatusNode {
  /** −1 empty (φ); 0/1 an unpaired input bit (T/H); 2/3 a pending output bit 0/1. */
  label: number
  left: StatusNode | null
  right: StatusNode | null
}

/**
 * Create a streaming debiaser. 'von-neumann': pairs 01→0, 10→1, the odd bit
 * carried to the next push — output identical to `vonNeumann` over the whole
 * input. 'peres': Zhou & Bruck's random-stream algorithm (arXiv:1209.0730,
 * 2012), the streaming form of Peres's iterated von Neumann. Each status-tree
 * node receiving y with label x:
 *   x = φ → x := y;   x = output bit b → emit b, x := y;
 *   x = y → x := φ, pass 0 (x ⊕ y) to the left child, then x to the right child;
 *   x ≠ y → x := output bit x, pass 1 to the left child
 * (children below `maxDepth` are never created). The output is a stream of
 * random bits for any biased iid input (their Theorems 2 and 4: stopped at
 * any k bits, those k bits are independent and unbiased), with rate → H(p).
 * Order differs from the batch `peres`, and an output bit still pending in a
 * node when the input ends is never released — the price of the stream
 * property. (Emitting pair outputs immediately in Peres's order is NOT
 * unbiased — the test suite checks both claims exhaustively.)
 */
export function createDebiaser(method: DebiasMethod, maxDepth = 16): BitDebiaser {
  if (method !== 'von-neumann' && method !== 'peres') {
    throw new NegentropyError(
      'invalid_config',
      `debias method must be peres|von-neumann, got ${String(method)}`,
    )
  }
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 32) {
    throw new NegentropyError(
      'invalid_config',
      `maxDepth must be an integer in [1, 32], got ${maxDepth}`,
    )
  }
  let out: number[] = []
  const take = () => {
    const bits = out
    out = []
    return bits
  }
  if (method === 'von-neumann') {
    let pending = -1
    return {
      push(bit) {
        const b = bit & 1
        if (pending < 0) {
          pending = b
          return
        }
        if (pending !== b) out.push(pending)
        pending = -1
      },
      take,
    }
  }
  const node = (): StatusNode => ({ label: -1, left: null, right: null })
  const root = node()
  const receive = (target: StatusNode, y: number, depth: number): void => {
    const x = target.label
    if (x === -1) {
      target.label = y
    } else if (x >= 2) {
      out.push(x - 2)
      target.label = y
    } else if (x === y) {
      target.label = -1
      if (depth < maxDepth) {
        target.left ??= node()
        receive(target.left, 0, depth + 1)
        target.right ??= node()
        receive(target.right, x, depth + 1)
      }
    } else {
      target.label = 2 + x
      if (depth < maxDepth) {
        target.left ??= node()
        receive(target.left, 1, depth + 1)
      }
    }
  }
  return { push: (bit) => receive(root, bit & 1, 1), take }
}

/**
 * Streaming debiasing of raw bytes (bits MSB-first): state — the odd bit, the
 * random-stream status tree, and a partial output byte — carries across
 * chunks, so the output does not depend on how the input is chunked. Yields
 * the whole output bytes (MSB-first) completed by each input chunk; trailing
 * bits (< 8) are dropped when the input ends. Same iid-input requirement as
 * `vonNeumann`/`peres`; see `createDebiaser` for the algorithms. Lazy and
 * pull-based.
 *
 * Errors: bad options → `invalid_config` (on the first pull); a
 * non-Uint8Array chunk → `invalid_config`; an upstream error →
 * `source_failed`; abort → `aborted`, raced against a pending pull. The
 * upstream is closed on abort, error, or early exit.
 */
export async function* debiasStream(
  raw: AsyncIterable<Uint8Array>,
  method: DebiasMethod = 'peres',
  opts: DebiasStreamOptions = {},
): AsyncGenerator<Uint8Array> {
  const debiaser = createDebiaser(method, opts.maxDepth ?? 16)
  if (raw === null || typeof raw !== 'object' || !(Symbol.asyncIterator in raw)) {
    throw new NegentropyError('invalid_config', 'debiasStream input must be an AsyncIterable')
  }
  const { signal } = opts
  const abortError = () => new NegentropyError('aborted', 'debias stream aborted')
  if (signal?.aborted) throw abortError()

  let partial = 0 // bits of the unfinished output byte
  let partialBits = 0
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
        throw new NegentropyError('invalid_config', 'debiasStream chunks must be Uint8Array')
      }
      const bytes: number[] = []
      for (let i = 0; i < chunk.length; i++) {
        const byte = chunk[i] as number
        for (let b = 7; b >= 0; b--) debiaser.push((byte >> b) & 1)
        for (const bit of debiaser.take()) {
          partial = (partial << 1) | bit
          if (++partialBits === 8) {
            bytes.push(partial)
            partial = 0
            partialBits = 0
          }
        }
      }
      if (bytes.length > 0) {
        yield Uint8Array.from(bytes)
        if (signal?.aborted) throw abortError()
      }
    }
  } catch (error) {
    if (error instanceof NegentropyError) throw error
    if (signal?.aborted) {
      throw new NegentropyError('aborted', 'debias stream aborted', { cause: error })
    }
    throw new NegentropyError('source_failed', 'debiasStream upstream failed', { cause: error })
  } finally {
    if (!exhausted) await closeIterator(iterator, signal?.aborted === true)
  }
}
