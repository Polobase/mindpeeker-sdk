/**
 * Script-only statistical helpers. The general estimator suite (shannon,
 * min-entropy, chi-square, serial correlation, monobit, runs) moved to
 * `@mindpeeker/negentropy` — import it from there. What remains here is the
 * pair that doesn't belong in a browser-safe public API.
 */

/** Monte-Carlo π from 24-bit coordinate pairs (ent's classic). */
export function monteCarloPi(data: Uint8Array): number {
  let inside = 0
  let total = 0
  for (let i = 0; i + 6 <= data.length; i += 6) {
    const x =
      (((data[i] as number) << 16) | ((data[i + 1] as number) << 8) | (data[i + 2] as number)) /
      0xffffff
    const y =
      (((data[i + 3] as number) << 16) | ((data[i + 4] as number) << 8) | (data[i + 5] as number)) /
      0xffffff
    if (x * x + y * y < 1) inside++
    total++
  }
  return total === 0 ? 0 : (4 * inside) / total
}

/** gzip compression ratio: ≈1 means incompressible (as randomness should be). */
export function compressionRatio(data: Uint8Array<ArrayBuffer>): number {
  return Bun.gzipSync(data).length / data.length
}
