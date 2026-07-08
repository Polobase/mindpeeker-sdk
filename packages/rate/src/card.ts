import { digitToAngle } from './angle.js'
import { RateError } from './errors.js'
import type { Rate, RateCardGeometry, RingMark } from './types.js'

export interface CardGeometryOptions {
  /** Radius of the innermost ring, card units (default 0.2). */
  innerRadius?: number
  /** Radius of the outermost ring, card units (default 1). */
  outerRadius?: number
  /**
   * Fixed radial spacing between consecutive rings. When set it overrides the
   * even inner→outer spread: ring $i$ sits at `outerRadius - i * ringGap`
   * (outermost first), so cards with different digit counts share a rim.
   */
  ringGap?: number
  /** Optional per-ring labels carried through onto the geometry. */
  labels?: readonly string[]
}

/**
 * Build the pure geometric data for a Magneto-Geometric card: one concentric
 * ring per rate digit, each carrying a radial line at
 * $\theta = \mathrm{digit}\cdot\tfrac{2\pi}{\mathrm{base}}$.
 *
 * Rae's cards are "a series of concentric circles containing a number of
 * partial radii of equal length", the informational pattern being the *set of
 * angles* of those radii (radionics.co.uk, MGA-Rae information). This function
 * returns exactly that — radius/angle pairs — with **no rendering**; feed it to
 * {@link cardSvg} or a WebGL visualiser.
 *
 * Rings are ordered innermost → outermost. With `n` digits and the default
 * even spread, ring $i$ has radius
 * $r_i = r_\text{in} + i\,\tfrac{r_\text{out}-r_\text{in}}{n-1}$
 * (a single ring sits at `outerRadius`).
 *
 * @throws {RateError} `invalid_rate` for empty rates, non-positive radii, or an
 *   inverted inner/outer pair.
 */
export function cardGeometry(rate: Rate, opts: CardGeometryOptions = {}): RateCardGeometry {
  const inner = opts.innerRadius ?? 0.2
  const outer = opts.outerRadius ?? 1
  const n = rate.digits.length
  if (n === 0) throw new RateError('invalid_rate', 'cannot build a card from an empty rate')
  if (inner <= 0 || outer <= 0 || inner > outer) {
    throw new RateError('invalid_rate', `bad radii: inner=${inner}, outer=${outer}`)
  }
  if (opts.ringGap !== undefined && !(opts.ringGap > 0)) {
    throw new RateError('invalid_rate', `ringGap must be positive, got ${opts.ringGap}`)
  }
  if (opts.ringGap !== undefined && outer - (n - 1) * opts.ringGap <= 0) {
    throw new RateError(
      'invalid_rate',
      `ringGap ${opts.ringGap} too large: innermost of ${n} rings would have radius ` +
        `${outer - (n - 1) * opts.ringGap} <= 0`,
    )
  }
  const rings: RingMark[] = []
  for (let i = 0; i < n; i++) {
    let radius: number
    if (opts.ringGap !== undefined) {
      radius = outer - (n - 1 - i) * opts.ringGap
    } else if (n === 1) {
      radius = outer
    } else {
      radius = inner + (i * (outer - inner)) / (n - 1)
    }
    rings.push({ radius, angleRad: digitToAngle(rate.digits[i] as number, rate.base) })
  }
  return opts.labels !== undefined
    ? { rings, base: rate.base, labels: opts.labels }
    : { rings, base: rate.base }
}

export interface CardSvgOptions {
  /** SVG width/height in pixels (square). Default 256. */
  size?: number
  /** Stroke colour of rings and radii. Default `'#222'`. */
  stroke?: string
  /** Stroke width in pixels. Default 1. */
  strokeWidth?: number
  /** Background fill, or `'none'`. Default `'none'`. */
  background?: string
  /** Decimal places for coordinates (determinism). Default 3. */
  precision?: number
}

/**
 * Render a {@link RateCardGeometry} to a standalone SVG string — pure string
 * building, no DOM, safe on any runtime. For printing, diffing, or snapshot
 * inspection of a card.
 *
 * The angle convention matches practitioner cards: $\theta = 0$ points **up**
 * (12 o'clock / north) and increases **clockwise**, i.e. screen coordinates
 * $x = c + r\sin\theta,\ y = c - r\cos\theta$ where $c$ is the centre. Each
 * ring is drawn as a full circle plus a radius from the centre to its marked
 * angle.
 */
export function cardSvg(geometry: RateCardGeometry, opts: CardSvgOptions = {}): string {
  const size = opts.size ?? 256
  const stroke = opts.stroke ?? '#222'
  const strokeWidth = opts.strokeWidth ?? 1
  const background = opts.background ?? 'none'
  const p = opts.precision ?? 3
  const c = size / 2
  // Scale card units (outer radius ~1) to fit with a small margin.
  const maxRadius = geometry.rings.reduce((m, r) => Math.max(m, r.radius), 0) || 1
  const scale = (size / 2 - strokeWidth) / maxRadius
  const fmt = (x: number): string => x.toFixed(p)

  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
      `viewBox="0 0 ${size} ${size}">`,
  )
  if (background !== 'none') {
    parts.push(`<rect width="${size}" height="${size}" fill="${background}"/>`)
  }
  parts.push(
    `<g fill="none" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round">`,
  )
  for (const ring of geometry.rings) {
    const r = ring.radius * scale
    const x = c + r * Math.sin(ring.angleRad)
    const y = c - r * Math.cos(ring.angleRad)
    parts.push(`<circle cx="${fmt(c)}" cy="${fmt(c)}" r="${fmt(r)}"/>`)
    parts.push(`<line x1="${fmt(c)}" y1="${fmt(c)}" x2="${fmt(x)}" y2="${fmt(y)}"/>`)
  }
  parts.push('</g>')
  parts.push('</svg>')
  return parts.join('')
}
