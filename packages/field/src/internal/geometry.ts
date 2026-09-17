/**
 * Closed-form planar geometry for edge corrections: areas of a disk clipped
 * by the study region, the fraction of a circle's circumference inside it,
 * and the overlap of the region with a translated copy of itself. All
 * functions accept centres slightly outside the region (float rounding) and
 * never throw.
 */
import type { FieldRegion, Point } from '../types.js'

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

/** Antiderivative of $\sqrt{r^2 - x^2} - h$ in $x$. */
function chordIntegral(x: number, h: number, r: number): number {
  const s = Math.sqrt(Math.max(0, r * r - x * x))
  return 0.5 * (x * s + r * r * Math.asin(clamp(x / r, -1, 1))) - h * x
}

/** Area of $\{x_0 \le X \le x_1,\ h \le Y \le \sqrt{r^2 - X^2}\}$ for $h \ge 0$ (circle at origin). */
function areaAbove(x0: number, x1: number, h: number, r: number): number {
  if (h >= r) return 0
  const s = Math.sqrt(r * r - h * h)
  const a = clamp(x0, -s, s)
  const b = clamp(x1, -s, s)
  return b > a ? chordIntegral(b, h, r) - chordIntegral(a, h, r) : 0
}

/** Area of the origin-centred disk of radius r inside $[x_0,x_1]\times[y_0,y_1]$. */
function areaInBox(x0: number, x1: number, y0: number, y1: number, r: number): number {
  if (y0 < 0) {
    if (y1 <= 0) return areaInBox(x0, x1, -y1, -y0, r)
    return areaInBox(x0, x1, 0, -y0, r) + areaInBox(x0, x1, 0, y1, r)
  }
  return Math.max(0, areaAbove(x0, x1, y0, r) - areaAbove(x0, x1, y1, r))
}

/**
 * $|B((c_x, c_y), r) \cap [0,w]\times[0,h]|$ — exact, by integrating chord
 * lengths $\int \big(\sqrt{r^2-x^2} - y_0\big)\,dx$ in closed form over the
 * clipped abscissae (split at $y = 0$).
 */
export function circleRectArea(cx: number, cy: number, r: number, w: number, h: number): number {
  if (!(r > 0)) return 0
  if (cx - r >= 0 && cx + r <= w && cy - r >= 0 && cy + r <= h) return Math.PI * r * r
  const x0 = -cx
  const x1 = w - cx
  const y0 = -cy
  const y1 = h - cy
  if (x1 <= -r || x0 >= r || y1 <= -r || y0 >= r) return 0
  return Math.min(Math.PI * r * r, w * h, areaInBox(x0, x1, y0, y1, r))
}

/**
 * Area of the intersection of two disks with radii `r` and `R` whose centres
 * are `rho` apart (the lens area).
 */
export function lensArea(rho: number, r: number, R: number): number {
  if (!(r > 0) || !(R > 0)) return 0
  if (rho >= r + R) return 0
  const small = Math.min(r, R)
  if (rho <= Math.abs(R - r)) return Math.PI * small * small
  const a = clamp((rho * rho + r * r - R * R) / (2 * rho * r), -1, 1)
  const b = clamp((rho * rho + R * R - r * r) / (2 * rho * R), -1, 1)
  const k = (-rho + r + R) * (rho + r - R) * (rho - r + R) * (rho + r + R)
  const area = r * r * Math.acos(a) + R * R * Math.acos(b) - 0.5 * Math.sqrt(Math.max(0, k))
  return clamp(area, 0, Math.PI * small * small)
}

/** $|B(p, r) \cap W|$ for the study region $W$. */
export function circleRegionArea(p: Point, r: number, region: FieldRegion): number {
  return region.kind === 'rect'
    ? circleRectArea(p.x, p.y, r, region.width, region.height)
    : lensArea(Math.hypot(p.x, p.y), r, region.radius)
}

/** Distance from `p` to the region boundary (0 for points on or just outside it). */
export function borderDistance(p: Point, region: FieldRegion): number {
  if (region.kind === 'rect') {
    return Math.max(0, Math.min(p.x, region.width - p.x, p.y, region.height - p.y))
  }
  return Math.max(0, region.radius - Math.hypot(p.x, p.y))
}

const TINY = Number.EPSILON

/** Half-angle of the arc beyond an edge at perpendicular distance d: acos(d/r) when d < r. */
function hang(d: number, r: number): number {
  return d < r ? Math.acos(d / r) : 0
}

/**
 * Fraction of the circumference of the circle $\partial B((x, y), r)$ lying
 * inside $[0,w]\times[0,h]$ — Ripley's (1977) closed form as implemented in
 * spatstat's `edge.Ripley` (interpreted method): the directions from the
 * centre are partitioned by the four corner directions, and within the
 * sector of an edge at distance $d$ the circle is outside iff the direction
 * is within $\arccos(d/r)$ of the edge normal.
 */
export function arcFractionInRect(x: number, y: number, r: number, w: number, h: number): number {
  if (!(r > 0)) return 1
  const dL = Math.max(0, x)
  const dR = Math.max(0, w - x)
  const dD = Math.max(0, y)
  const dU = Math.max(0, h - y)
  if (r <= dL && r <= dR && r <= dD && r <= dU) return 1
  const aL = hang(dL, r)
  const aR = hang(dR, r)
  const aD = hang(dD, r)
  const aU = hang(dU, r)
  let ext =
    Math.min(aL, Math.atan2(dU, dL)) +
    Math.min(aL, Math.atan2(dD, dL)) +
    Math.min(aR, Math.atan2(dU, dR)) +
    Math.min(aR, Math.atan2(dD, dR)) +
    Math.min(aU, Math.atan2(dL, dU)) +
    Math.min(aU, Math.atan2(dR, dU)) +
    Math.min(aD, Math.atan2(dL, dD)) +
    Math.min(aD, Math.atan2(dR, dD))
  const onEdges =
    (dL < TINY ? 1 : 0) + (dR < TINY ? 1 : 0) + (dD < TINY ? 1 : 0) + (dU < TINY ? 1 : 0)
  if (onEdges >= 2) ext += Math.PI / 2
  return clamp(1 - ext / (2 * Math.PI), 0, 1)
}

/**
 * Fraction of the circumference of a circle of radius `r`, centred `rho`
 * from the centre of a disk of radius `R`, lying inside that disk:
 * $1 - \arccos(c)/\pi$ with $c = (R^2 - \rho^2 - r^2)/(2\rho r)$.
 */
export function arcFractionInDisk(rho: number, r: number, R: number): number {
  if (!(r > 0)) return 1
  if (rho <= 0) return r <= R ? 1 : 0
  const c = (R * R - rho * rho - r * r) / (2 * rho * r)
  if (c >= 1) return 1
  if (c <= -1) return 0
  return 1 - Math.acos(c) / Math.PI
}

/** Circumference fraction of $\partial B(p, r)$ inside the region. */
export function arcFractionInRegion(p: Point, r: number, region: FieldRegion): number {
  return region.kind === 'rect'
    ? arcFractionInRect(p.x, p.y, r, region.width, region.height)
    : arcFractionInDisk(Math.hypot(p.x, p.y), r, region.radius)
}

/**
 * $|W \cap (W + (d_x, d_y))|$, the set covariance of the region at a
 * translation — rect: $(w-|d_x|)(h-|d_y|)$; disk: the lens of two radius-$R$
 * disks at distance $\sqrt{d_x^2+d_y^2}$.
 */
export function translationOverlap(dx: number, dy: number, region: FieldRegion): number {
  if (region.kind === 'rect') {
    return Math.max(0, region.width - Math.abs(dx)) * Math.max(0, region.height - Math.abs(dy))
  }
  return lensArea(Math.hypot(dx, dy), region.radius, region.radius)
}
