// Event logs for the seriality tab: parsing a pasted one, and drawing one from
// the header-selected entropy source.
//
// The generated log is the null itself — n independent uniform times on the
// span — so the p-value of a generated log is a calibration reading. A planted
// cluster is a positive control: the test should find it, which says the test
// works, not that anything happened.

import { uniformInt } from '@mindpeeker/oracle'
import type { ByteReader } from '@mindpeeker/oracle'
import { createYielder } from '~/lib/async'

/** Uniform draws are made on this grid, so a time is exact to 1e-6 of the span. */
const RESOLUTION = 1_000_000

/** The README's worked log: five events on day 1, then days 10 and 20. */
export const README_LOG: readonly number[] = [1.1, 1.2, 1.3, 1.4, 1.5, 10.5, 20.5]

export const MAX_EVENTS = 2000
/** Far below the SDK's MAX_WINDOWS: past this the bar chart stops being readable. */
export const MAX_WINDOWS_UI = 600

export interface ParsedTimes {
  readonly times: readonly number[]
  readonly error?: string
}

/** Parse whitespace/comma/semicolon separated timestamps, sorted ascending. */
export function parseTimes(text: string): ParsedTimes {
  const tokens = text.split(/[\s,;]+/).filter((token) => token.length > 0)
  if (tokens.length === 0) return { times: [], error: 'Enter at least one timestamp.' }
  if (tokens.length > MAX_EVENTS) {
    return { times: [], error: `That is ${tokens.length} events; this page stops at ${MAX_EVENTS}.` }
  }
  const times: number[] = []
  for (const token of tokens) {
    const value = Number(token)
    if (!Number.isFinite(value)) return { times: [], error: `“${token}” is not a number.` }
    times.push(value)
  }
  times.sort((a, b) => a - b)
  return { times }
}

export function formatTimes(times: readonly number[], digits = 3): string {
  return times.map((t) => Number(t.toFixed(digits)).toString()).join(' ')
}

export interface GenerateOptions {
  /** Events drawn uniformly over the whole span. */
  readonly n: number
  readonly span: number
  /** Extra events confined to one interval — a positive control. */
  readonly cluster?: { readonly count: number; readonly start: number; readonly width: number }
  readonly signal?: AbortSignal
  readonly onProgress?: (fraction: number) => void
}

/**
 * Draw an event log from a byte reader: `n` uniform times on [0, span], plus an
 * optional planted burst. Times land on a 1e-6 grid, which `uniformInt` fills
 * without modulo bias.
 */
export async function generateSeries(
  reader: ByteReader,
  options: GenerateOptions,
): Promise<number[]> {
  const tick = createYielder(8, options.signal)
  const total = options.n + (options.cluster?.count ?? 0)
  const times: number[] = []
  for (let i = 0; i < options.n; i++) {
    times.push((options.span * (await uniformInt(reader, RESOLUTION))) / RESOLUTION)
    if ((i & 31) === 0) {
      options.onProgress?.(times.length / Math.max(1, total))
      await tick()
    }
  }
  const cluster = options.cluster
  if (cluster && cluster.count > 0) {
    const width = Math.max(0, Math.min(cluster.width, options.span - cluster.start))
    for (let i = 0; i < cluster.count; i++) {
      const offset = (width * (await uniformInt(reader, RESOLUTION))) / RESOLUTION
      times.push(Math.min(options.span, cluster.start + offset))
      if ((i & 31) === 0) {
        options.onProgress?.(times.length / Math.max(1, total))
        await tick()
      }
    }
  }
  options.onProgress?.(1)
  times.sort((a, b) => a - b)
  return times
}

/** Windows the SDK will tile the span into — the UI refuses absurd grids first. */
export function windowCount(span: number, window: number): number {
  if (!(window > 0) || !(span > 0)) return 0
  return Math.max(1, Math.ceil(span / window - 1e-9))
}
