// Shapes shared by the spatial-field page: the study windows, the lab
// parameters, the canvas overlays and the byte arithmetic of a Monte-Carlo run.
//
// SDK imports here are TYPE-ONLY, so nothing of @mindpeeker survives at
// runtime and the module is safe for the client and the worker alike.

import type { FieldRegion, Point } from '@mindpeeker/field'

export type RegionKind = 'rect' | 'disk'

/** The window the field README simulates in (100 × 80 = 8 000 area units). */
export const RECT_REGION: FieldRegion = { kind: 'rect', width: 100, height: 80 }
/** A disk of almost the same area (π·50² = 7 854), so the radii carry over. */
export const DISK_REGION: FieldRegion = { kind: 'disk', radius: 50 }

export function regionOf(kind: RegionKind): FieldRegion {
  return kind === 'disk' ? DISK_REGION : RECT_REGION
}

/** λ's denominator: |W|. */
export function areaOf(region: FieldRegion): number {
  return region.kind === 'rect'
    ? region.width * region.height
    : Math.PI * region.radius * region.radius
}

/** Where a planted cluster is dropped. */
export function regionCentre(region: FieldRegion): Point {
  return region.kind === 'rect'
    ? { x: region.width / 2, y: region.height / 2 }
    : { x: 0, y: 0 }
}

/** Axis-aligned bounding box `[x0, y0, x1, y1]` — the canvas viewport. */
export function regionBox(region: FieldRegion): [number, number, number, number] {
  return region.kind === 'rect'
    ? [0, 0, region.width, region.height]
    : [-region.radius, -region.radius, region.radius, region.radius]
}

export function regionLabel(region: FieldRegion): string {
  return region.kind === 'rect'
    ? `rect ${region.width} × ${region.height}`
    : `disk r = ${region.radius}`
}

/** The radii registered before a field is drawn (the cookbook's set). */
export const DEFAULT_RADII: readonly number[] = [2, 4, 6, 8, 10, 14]
/** A denser grid for the "run more" path — still fixed before the draw. */
export const FINE_RADII: readonly number[] = [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18]

/** Where the simulated CSR fields get their bytes. */
export type NullSourceId = 'local' | 'selected' | 'drbg'

export interface LabParams {
  /** Points in the field. */
  count: number
  regionKind: RegionKind
  /** Replace a share of the points by a tight blob at the centre (positive control). */
  planted: boolean
  /** Share of the points moved into the blob, in percent. */
  plantedPercent: number
  /** Blob radius, in region units. */
  plantedRadius: number
  /** Byte source for the simulated null fields of every Monte-Carlo test. */
  nullSource: NullSourceId
}

export interface DrawAccounting {
  bytesConsumed: number
  bitsUsed: number
  bytesFetched?: number
}

export interface FieldSourceInfo {
  id: string
  label: string
  providerName: string
  deterministic: boolean
  seedLabel?: string
}

/** One drawn field — everything every section on the page measures. */
export interface LabField {
  points: readonly Point[]
  region: FieldRegion
  params: LabParams
  accounting: DrawAccounting
  /** Points that came from the planted blob (0 when the toggle is off). */
  plantedCount: number
  /** Centre of the planted blob, for the canvas. */
  plantedCentre?: Point
  plantedRadius?: number
  source: FieldSourceInfo
  elapsedMs: number
  /** Monotonic id, so a section can tell "measured" from "stale". */
  serial: number
}

export type OverlayColor = 1 | 2 | 3 | 4 | 5 | 6

export interface OverlayCircle {
  kind: 'circle'
  x: number
  y: number
  r: number
  color: OverlayColor
  label?: string
  dashed?: boolean
}

export interface OverlayDot {
  kind: 'dot'
  x: number
  y: number
  color: OverlayColor
  label?: string
}

export interface OverlayGrid {
  kind: 'grid'
  nx: number
  ny: number
  color: OverlayColor
  label?: string
}

export type FieldOverlay = OverlayCircle | OverlayDot | OverlayGrid

/** Exactly what a Monte-Carlo run costs: 8 bytes per point per simulated field. */
export const BYTES_PER_POINT = 8

export function nullBytesNeeded(runs: number, count: number): number {
  return runs * count * BYTES_PER_POINT
}

/**
 * Split `runs` into batches so the worker can report progress. The ranks of
 * the batches add up to the rank of one run of `runs` simulations, because
 * every batch ranks the same observed statistic against fresh CSR fields.
 */
export function runBatches(runs: number, target = 10): number[] {
  const batches = Math.max(1, Math.min(target, runs))
  const base = Math.floor(runs / batches)
  const rest = runs - base * batches
  return Array.from({ length: batches }, (_, i) => base + (i < rest ? 1 : 0)).filter((m) => m > 0)
}
