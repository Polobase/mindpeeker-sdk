import { FieldError } from './errors.js'

/** A 2-D point in region coordinates (rect: [0,width)×[0,height); disk: centered at origin). */
export interface Point {
  readonly x: number
  readonly y: number
}

/** The bounded study region a field lives in. */
export type FieldRegion =
  | { readonly kind: 'rect'; readonly width: number; readonly height: number }
  | { readonly kind: 'disk'; readonly radius: number }

/** Honest receipt of the entropy a sampling call spent (mirrors the oracle's shape). */
export interface EntropyAccounting {
  readonly bytesConsumed: number
  readonly bitsUsed: number
}

/** Area of a region — the denominator of the CSR intensity λ = n/A. */
export function regionArea(region: FieldRegion): number {
  return region.kind === 'rect'
    ? region.width * region.height
    : Math.PI * region.radius * region.radius
}

/** Validate a region's dimensions are finite and positive. */
export function validateRegion(region: FieldRegion): void {
  const dims = region.kind === 'rect' ? [region.width, region.height] : [region.radius]
  for (const d of dims) {
    if (!Number.isFinite(d) || d <= 0) {
      throw new FieldError('invalid_config', `region dimensions must be finite and > 0, got ${d}`)
    }
  }
}
