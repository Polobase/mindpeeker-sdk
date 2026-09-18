// Curve builders. Every closed form here is a handful of logarithms per point,
// so these run live; the expensive families (non-uniform, k-fold) are chunked
// or run in the worker instead.

import {
  birthdayApprox,
  birthdayMatch,
  multiCategoryMatch,
  nearMatch,
  probabilityAtLeastOne,
} from '@mindpeeker/coincidence'

/** Integer draw counts 1…nMax, thinned to at most `points` values. */
export function drawGrid(nMax: number, points = 220): number[] {
  const top = Math.max(2, Math.floor(nMax))
  const step = Math.max(1, Math.ceil(top / points))
  const out: number[] = []
  for (let n = 1; n <= top; n += step) out.push(n)
  if (out[out.length - 1] !== top) out.push(top)
  return out
}

/**
 * A sensible x-range for a birthday curve over c categories: past the 99 %
 * point there is nothing left to see, and small c stops at c + 1 (pigeonhole).
 */
export function birthdayRange(c: number, atLeast = 2): number {
  const ninetyNine = Math.ceil(Math.sqrt(2 * c * Math.log(100)) * 1.1)
  return Math.max(atLeast, Math.min(c + 1, Math.max(8, ninetyNine)))
}

export interface BirthdayCurve {
  readonly x: number[]
  /** Exact $1 - \prod_{i<n}(1 - i/c)$. */
  readonly exact: number[]
  /** $1 - \exp(-n(n-1)/2c)$ — the pair-count approximation. */
  readonly approx: number[]
}

export function birthdayCurve(c: number, nMax: number): BirthdayCurve {
  const x = drawGrid(nMax)
  return {
    x,
    exact: x.map((n) => birthdayMatch(n, c)),
    approx: x.map((n) => 1 - birthdayApprox(n, c)),
  }
}

export interface NearCurve {
  readonly d: number
  readonly y: number[]
}

/** P(some pair within d) against n, one series per closeness window. */
export function nearCurves(
  c: number,
  ds: readonly number[],
  nMax: number,
  topology: 'circle' | 'line',
): { x: number[]; curves: NearCurve[] } {
  const x = drawGrid(nMax)
  return {
    x,
    curves: ds.map((d) => ({ d, y: x.map((n) => nearMatch(n, c, d, { topology })) })),
  }
}

export interface MultiCurve {
  readonly x: number[]
  /** Exact product over the attributes. */
  readonly exact: number[]
  /** Diaconis–Mosteller: one attribute with $H/k$ values, pair-count approximated. */
  readonly harmonic: number[]
}

export function multiCurve(cs: readonly number[], effective: number, nMax: number): MultiCurve {
  const x = drawGrid(nMax)
  return {
    x,
    exact: x.map((n) => multiCategoryMatch(n, cs)),
    harmonic: x.map((n) => 1 - birthdayApprox(n, effective)),
  }
}

export interface LargeNumbersCurve {
  /** $\log_{10} N$ — the x axis, because N spans ten decades. */
  readonly x: number[]
  readonly atLeastOne: number[]
  /** $Np$, clipped at 1 for the chart. */
  readonly expectedClipped: number[]
}

/** P(at least one) against the number of opportunities, over `decades` decades. */
export function largeNumbersCurve(p: number, fromLog10: number, toLog10: number): LargeNumbersCurve {
  const x: number[] = []
  const steps = 160
  for (let i = 0; i <= steps; i++) x.push(fromLog10 + ((toLog10 - fromLog10) * i) / steps)
  return {
    x,
    atLeastOne: x.map((lx) => probabilityAtLeastOne(10 ** lx, p)),
    expectedClipped: x.map((lx) => Math.min(1, 10 ** lx * p)),
  }
}
