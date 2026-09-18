// SVG geometry for the two views the package itself does not render: the dial
// per ring, and the phasor plot behind the circular statistics.
//
// Both use the card convention `cardSvg` uses: θ = 0 points up (12 o'clock)
// and increases clockwise, i.e. x = c + r·sinθ, y = c − r·cosθ.
//
// CLIENT-ONLY: imports `@mindpeeker/rate`.

import { digitToAngle, digitToDegrees } from '@mindpeeker/rate'

export interface Point {
  readonly x: number
  readonly y: number
}

export function polar(cx: number, cy: number, radius: number, angleRad: number): Point {
  return { x: cx + radius * Math.sin(angleRad), y: cy - radius * Math.cos(angleRad) }
}

export interface DialTick {
  readonly key: number
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  readonly major: boolean
}

export interface DialView {
  readonly ring: number
  readonly digit: number
  readonly label: number
  readonly degrees: number
  readonly radians: number
  readonly size: number
  readonly cx: number
  readonly cy: number
  readonly r: number
  readonly ticks: readonly DialTick[]
  readonly needle: Point
  readonly ariaLabel: string
}

/**
 * One dial: every calibration of the base as a tick, the rate's digit as the
 * needle. Every tick position comes from `digitToAngle`, so the picture and the
 * table cannot drift apart.
 */
export function buildDial(
  ring: number,
  digit: number,
  base: number,
  oneBasedLabel: boolean,
  size = 112,
): DialView {
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 8
  const majorEvery = base % 4 === 0 ? base / 4 : base <= 12 ? 1 : 5
  const ticks: DialTick[] = []
  for (let d = 0; d < base; d++) {
    const angle = digitToAngle(d, base)
    const major = d % majorEvery === 0
    const inner = polar(cx, cy, r - (major ? 9 : 5), angle)
    const outer = polar(cx, cy, r, angle)
    ticks.push({ key: d, x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y, major })
  }
  const radians = digitToAngle(digit, base)
  return {
    ring,
    digit,
    label: oneBasedLabel ? digit + 1 : digit,
    degrees: digitToDegrees(digit, base),
    radians,
    size,
    cx,
    cy,
    r,
    ticks,
    needle: polar(cx, cy, r - 3, radians),
    ariaLabel: `Ring ${ring}: digit ${digit} of base ${base}, a radial line at ${digitToDegrees(
      digit,
      base,
    ).toFixed(2)} degrees clockwise from twelve o'clock`,
  }
}

export interface PhasorView {
  readonly size: number
  readonly cx: number
  readonly cy: number
  readonly r: number
  readonly spokes: readonly { key: number; x: number; y: number; digit: number }[]
  readonly resultant: Point
  readonly resultantHead: readonly Point[]
  readonly gridAngles: readonly { key: number; x: number; y: number }[]
}

/**
 * Unit phasors for every ring plus the mean resultant vector, whose *length* is
 * R̄ ∈ [0, 1] and whose direction is the circular mean.
 */
export function buildPhasor(
  digits: readonly number[],
  base: number,
  resultantLengthValue: number,
  meanAngle: number,
  size = 240,
): PhasorView {
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 16
  const spokes = digits.map((digit, key) => {
    const p = polar(cx, cy, r, digitToAngle(digit, base))
    return { key, x: p.x, y: p.y, digit }
  })
  const resultant = polar(cx, cy, r * resultantLengthValue, meanAngle)
  // A small arrow head, only drawn when the resultant is long enough to see.
  const headSpread = 0.22
  const headLength = Math.min(10, r * resultantLengthValue * 0.35)
  const head = [
    resultant,
    polar(cx, cy, r * resultantLengthValue - headLength, meanAngle - headSpread),
    polar(cx, cy, r * resultantLengthValue - headLength, meanAngle + headSpread),
  ]
  const gridAngles = [0, 0.25, 0.5, 0.75].map((f, key) => {
    const p = polar(cx, cy, r, f * 2 * Math.PI)
    return { key, x: p.x, y: p.y }
  })
  return { size, cx, cy, r, spokes, resultant, resultantHead: head, gridAngles }
}
