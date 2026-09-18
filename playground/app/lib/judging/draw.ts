/**
 * Draws for the judging page — every one of them goes through `~/lib/entropy`,
 * so the header's source picker and DRBG seed govern the deck you are dealt,
 * the calls a control arm makes, and the ranks a null judge produces.
 *
 * CLIENT ONLY: this module imports `@mindpeeker/*` (Vite-aliased to package
 * source), so only `*.client.vue` components may import it.
 */
import type { EntropyProvider } from '@mindpeeker/entropy'
import { drawWithoutReplacement, uniformInt } from '@mindpeeker/oracle'
import { throwIfAborted } from '~/lib/async'
import { withReader } from '~/lib/entropy'

export interface DrawOptions {
  readonly signal?: AbortSignal
  /** Draw from this provider instead of the header's selection (control arms). */
  readonly source?: EntropyProvider
}

function readerOptions(options: DrawOptions): { signal?: AbortSignal; source?: EntropyProvider } {
  return {
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.source ? { source: options.source } : {}),
  }
}

/** The pack as a flat symbol list: [5,5,5,5,5] → 0,0,0,0,0,1,1,… */
export function packSymbols(counts: readonly number[]): number[] {
  const out: number[] = []
  counts.forEach((copies, symbol) => {
    for (let i = 0; i < copies; i++) out.push(symbol)
  })
  return out
}

/**
 * One uniformly shuffled closed pack. `drawWithoutReplacement(reader, N, N)`
 * is a full Fisher–Yates permutation with exactly uniform swap indices, so
 * every distinct order of the pack has the same probability — the assumption
 * `closedDeckMatchDistribution` computes under.
 */
export async function shuffledPack(
  counts: readonly number[],
  options: DrawOptions = {},
): Promise<number[]> {
  const cards = packSymbols(counts)
  const order = await withReader(
    (reader) => drawWithoutReplacement(reader, cards.length, cards.length),
    readerOptions(options),
  )
  return order.map((position) => cards[position] as number)
}

/** `n` independent uniform symbols in 0…k−1 (a caller with no information). */
export async function uniformSymbols(
  n: number,
  k: number,
  options: DrawOptions = {},
): Promise<number[]> {
  return await withReader(async (reader) => {
    const out: number[] = []
    for (let i = 0; i < n; i++) {
      throwIfAborted(options.signal)
      out.push(await uniformInt(reader, k))
    }
    return out
  }, readerOptions(options))
}

/** `n` independent uniform ranks in 1…k — the null a rank-order test assumes. */
export async function uniformRanks(
  n: number,
  k: number,
  options: DrawOptions = {},
): Promise<number[]> {
  const draws = await uniformSymbols(n, k, options)
  return draws.map((r) => r + 1)
}

/** A k × k matrix whose rows are independent random rank permutations of 1…k. */
export async function randomRankMatrix(
  k: number,
  options: DrawOptions = {},
): Promise<number[][]> {
  return await withReader(async (reader) => {
    const rows: number[][] = []
    for (let i = 0; i < k; i++) {
      throwIfAborted(options.signal)
      const order = await drawWithoutReplacement(reader, k, k)
      const row = new Array<number>(k)
      order.forEach((column, rank) => {
        row[column] = rank + 1
      })
      rows.push(row)
    }
    return rows
  }, readerOptions(options))
}

/**
 * Read's optimal strategy with trial-by-trial feedback: always call a most
 * represented remaining symbol (ties broken by the lowest index — the tie rule
 * does not change the distribution). No entropy is consumed: the strategy is
 * deterministic given what the guesser has already been shown.
 */
export function optimalFeedbackCalls(deck: readonly number[], counts: readonly number[]): number[] {
  const remaining = counts.slice()
  return deck.map((card) => {
    let best = 0
    for (let s = 1; s < remaining.length; s++) {
      if ((remaining[s] as number) > (remaining[best] as number)) best = s
    }
    remaining[card] = (remaining[card] as number) - 1
    return best
  })
}

/** Composition of a call sequence over `k` symbols. */
export function composition(calls: readonly number[], k: number): number[] {
  const out = new Array<number>(k).fill(0)
  for (const call of calls) out[call] = (out[call] as number) + 1
  return out
}

/**
 * A caller with a habit: with probability ½ they repeat their previous call,
 * otherwise they draw a fresh uniform symbol. The calls are still independent
 * of the targets — no information passes — but the *pattern* of the calls
 * changes, and that is exactly what moves the pooled displacement variance
 * (Bartlett's objection to Soal).
 */
export async function stickyCalls(
  n: number,
  k: number,
  options: DrawOptions = {},
): Promise<number[]> {
  return await withReader(async (reader) => {
    const out: number[] = []
    for (let i = 0; i < n; i++) {
      throwIfAborted(options.signal)
      const repeat = i > 0 && (await uniformInt(reader, 2)) === 0
      out.push(repeat ? (out[i - 1] as number) : await uniformInt(reader, k))
    }
    return out
  }, readerOptions(options))
}
