import { type FieldRegion, type Point, regionBounds } from '../types.js'

/**
 * For every point, the number of *other* points within Euclidean distance
 * `radius` ($d_{ij}^2 \le r^2$, the same test as a brute-force double loop).
 * Uses a uniform cell grid with cells at least `radius` wide, so only the
 * 3×3 neighbourhood of a point's cell is searched — O(n) for bounded
 * densities instead of O(n²). The cell count is capped near 2n.
 */
export function neighbourCounts(
  points: readonly Point[],
  radius: number,
  region: FieldRegion,
): Int32Array {
  const n = points.length
  const counts = new Int32Array(n)
  if (n < 2) return counts
  const [x0, y0, x1, y1] = regionBounds(region)
  const cap = Math.ceil(Math.sqrt(2 * n)) + 1
  const cols = Math.max(1, Math.min(cap, Math.floor((x1 - x0) / radius)))
  const rows = Math.max(1, Math.min(cap, Math.floor((y1 - y0) / radius)))
  const cellW = (x1 - x0) / cols
  const cellH = (y1 - y0) / rows
  const cellOf = new Int32Array(n)
  const start = new Int32Array(cols * rows + 1)
  for (let i = 0; i < n; i++) {
    const p = points[i] as Point
    const cx = Math.min(cols - 1, Math.max(0, Math.floor((p.x - x0) / cellW)))
    const cy = Math.min(rows - 1, Math.max(0, Math.floor((p.y - y0) / cellH)))
    const c = cx + cy * cols
    cellOf[i] = c
    start[c + 1] = (start[c + 1] as number) + 1
  }
  for (let c = 0; c < cols * rows; c++)
    start[c + 1] = (start[c + 1] as number) + (start[c] as number)
  const fill = start.slice(0, cols * rows)
  const order = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    const c = cellOf[i] as number
    order[fill[c] as number] = i
    fill[c] = (fill[c] as number) + 1
  }
  const r2 = radius * radius
  for (let i = 0; i < n; i++) {
    const p = points[i] as Point
    const c = cellOf[i] as number
    const cx = c % cols
    const cy = (c - cx) / cols
    let count = 0
    for (let gy = Math.max(0, cy - 1); gy <= Math.min(rows - 1, cy + 1); gy++) {
      for (let gx = Math.max(0, cx - 1); gx <= Math.min(cols - 1, cx + 1); gx++) {
        const g = gx + gy * cols
        for (let k = start[g] as number; k < (start[g + 1] as number); k++) {
          const j = order[k] as number
          if (j === i) continue
          const q = points[j] as Point
          const dx = p.x - q.x
          const dy = p.y - q.y
          if (dx * dx + dy * dy <= r2) count++
        }
      }
    }
    counts[i] = count
  }
  return counts
}

/** Lexicographic order on coordinates (x, then y) — an exact, order-invariant tie-break. */
export function compareXY(a: Point, b: Point): number {
  return a.x - b.x || a.y - b.y
}
