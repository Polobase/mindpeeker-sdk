/**
 * The default radionic base. Malcolm Rae fixed on **44** as, in his words, "the
 * minimum number of calibrations required on the dials of an instrument in
 * order that it may express, without interpolation, every concept included in
 * the human entity" (Magneto-Geometric Applications, 1970s).
 *
 * Every function here takes an explicit or per-{@link Rate} base, so base-10
 * (De La Warr / Copen dials) and base-336 (Combe) work identically — 44 is
 * only the default.
 */
export const DEFAULT_BASE = 44

/** $\tau = 2\pi$, one full turn in radians. */
export const TAU = 2 * Math.PI

/**
 * A radionic rate: an ordered tuple of digits in $[0, \mathrm{base})$.
 *
 * Each digit selects an angular position on one ring of a Magneto-Geometric
 * card via $\theta_d = d\,\tfrac{2\pi}{\mathrm{base}}$. Rae's published rate
 * books label digits **1..44** (one-based); this package's canonical internal
 * form is **0-based** so the angular map is a clean group homomorphism
 * $\mathbb{Z}_{b} \to S^1$. See `parseRate` / `formatRate` for the label
 * bridge.
 */
export interface Rate {
  readonly digits: readonly number[]
  readonly base: number
}

/** One radial mark on a card: a ring at `radius`, a line at `angleRad`. */
export interface RingMark {
  /** Ring radius in card units (0 = centre, `outerRadius` = rim). */
  readonly radius: number
  /** Angle of the radial line, radians, measured per {@link digitToAngle}. */
  readonly angleRad: number
}

/**
 * Pure geometric data for a Magneto-Geometric card — no DOM, no rendering.
 * One {@link RingMark} per rate digit, concentric, plus optional labels.
 */
export interface RateCardGeometry {
  readonly rings: readonly RingMark[]
  readonly base: number
  readonly labels?: readonly string[]
}

/** Result of projecting a dial rate onto a coarser/finer base. */
export interface DialConversion {
  /** The converted rate in the target base. */
  readonly rate: Rate
  /**
   * Largest per-digit angular disagreement introduced by rounding, radians.
   * Bounded above by $\tfrac{\pi}{\mathrm{targetBase}}$ (half a target step).
   */
  readonly maxErrorRad: number
}

/**
 * Structural view of a live byte source — identical shape to
 * `@mindpeeker/entropy`'s provider and `@mindpeeker/negentropy`'s
 * `TrialSource`, imported by neither. Any of them satisfies this.
 */
export interface ByteSource {
  readonly name: string
  stream(opts?: ByteStreamOptions): AsyncIterable<Uint8Array>
}

export interface ByteStreamOptions {
  signal?: AbortSignal
  /** Desired chunk size in bytes; passed through to the source. */
  chunkBytes?: number
}

/**
 * Anything the modulation generators accept as bytes: a finished buffer, a
 * raw async chunk stream, or a live {@link ByteSource}.
 */
export type ByteInput = Uint8Array | AsyncIterable<Uint8Array> | ByteSource

export interface ModulateOptions {
  signal?: AbortSignal
}
