import { describe, expect, test } from 'bun:test'
import { NegentropyError } from '../../src/errors.js'
import { convexRoot, expandToNonNegative } from '../../src/internal/convex-root.js'

describe('convexRoot', () => {
  test('increasing convex function: root from the right, f ≥ 0 at the answer', () => {
    const f = (x: number): number => Math.exp(x) - 5
    const root = convexRoot(f, Math.exp, 10, -10)
    expect(root).toBeCloseTo(Math.log(5), 12)
    expect(f(root)).toBeGreaterThanOrEqual(0)
  })

  test('decreasing convex function: root from the left, f ≥ 0 at the answer', () => {
    const f = (x: number): number => Math.exp(-x) - 0.5
    const root = convexRoot(f, (x) => -Math.exp(-x), -5, 20)
    expect(root).toBeCloseTo(Math.LN2, 12)
    expect(f(root)).toBeGreaterThanOrEqual(0)
  })

  test('falls back to bisection when the derivative is useless', () => {
    const f = (x: number): number => x * x - 2
    const root = convexRoot(f, () => Number.NaN, 2, 0)
    expect(root).toBeCloseTo(Math.SQRT2, 11)
    expect(f(root)).toBeGreaterThanOrEqual(0)
  })

  test('a start without f ≥ 0 is a typed numerical error', () => {
    const f = (x: number): number => x - 1
    expect(() => convexRoot(f, () => 1, 0, -1)).toThrow(NegentropyError)
  })
})

describe('expandToNonNegative', () => {
  test('doubles the step until f ≥ 0', () => {
    const x = expandToNonNegative((v) => v - 100, 0, 1, 1)
    expect(x).toBe(128)
    expect(expandToNonNegative((v) => -v - 5, 0, 1, -1)).toBe(-8)
  })

  test('throws numerical when no sign change exists', () => {
    expect(() => expandToNonNegative(() => -1, 0, 1, 1)).toThrow(NegentropyError)
  })
})
