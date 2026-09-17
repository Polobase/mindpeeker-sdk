import { NegentropyError } from '../errors.js'
import type { EventSpec } from './types.js'

export interface ResolvedWindow {
  /** First step of the window (clipped to the recorded steps). */
  start: number
  /** One past the last recorded step of the window. */
  end: number
  /** The whole window lies inside the recorded data. */
  closed: boolean
  /** Why the window is not closed (or is empty). */
  reason?: string
}

/**
 * Map a validated event window onto recorded steps. Index windows are closed
 * when end ≤ steps. Date windows use the timeline: start = first step stamped
 * ≥ start, end = first step stamped ≥ end; the window is closed only once
 * some step is stamped at or after its end — a recording that stops inside
 * the window cannot show that no further steps would have fallen in it.
 * A Date window needs a timeline covering every step (`invalid_window`).
 */
export function resolveWindow(
  spec: EventSpec,
  steps: number,
  timeline: Float64Array | undefined,
): ResolvedWindow {
  if (spec.start instanceof Date && spec.end instanceof Date) {
    if (!timeline) {
      throw new NegentropyError(
        'invalid_window',
        `event ${spec.id} uses Date bounds but no series carries timestamps for all ${steps} steps`,
      )
    }
    const startMs = spec.start.getTime()
    const endMs = spec.end.getTime()
    let start = timeline.findIndex((t) => t >= startMs)
    if (start === -1) start = steps
    const endIndex = timeline.findIndex((t) => t >= endMs)
    if (endIndex === -1) {
      return {
        start,
        end: steps,
        closed: false,
        reason: `Date window has not closed: no recorded step at or after ${spec.end.toISOString()}`,
      }
    }
    if (endIndex === start) {
      return { start, end: start, closed: true, reason: 'no recorded step inside the Date window' }
    }
    return { start, end: endIndex, closed: true }
  }
  const start = spec.start as number
  const end = spec.end as number
  if (end > steps) {
    return {
      start: Math.min(start, steps),
      end: steps,
      closed: false,
      reason: `window [${start}, ${end}) extends past the ${steps} recorded steps`,
    }
  }
  return { start, end, closed: true }
}
