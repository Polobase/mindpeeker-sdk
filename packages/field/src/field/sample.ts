import { type BitReader, bitReader, byteReader, type OracleInput } from '@mindpeeker/oracle'
import { FieldError, rethrowOracle } from '../errors.js'
import { type EntropyAccounting, type FieldRegion, type Point, validateRegion } from '../types.js'

/** A uniform float in [0, 1) from 32 fresh bits — exact, no rejection. */
async function unitFloat(bits: BitReader): Promise<number> {
  return (await bits.nextBits(32)) / 2 ** 32
}

/** One area-uniform point in the region from the bit reader. */
export async function samplePoint(bits: BitReader, region: FieldRegion): Promise<Point> {
  if (region.kind === 'rect') {
    const x = (await unitFloat(bits)) * region.width
    const y = (await unitFloat(bits)) * region.height
    return { x, y }
  }
  // area-uniform disk: r = R√u keeps density flat (r ∝ √u, not u)
  const r = region.radius * Math.sqrt(await unitFloat(bits))
  const theta = 2 * Math.PI * (await unitFloat(bits))
  return { x: r * Math.cos(theta), y: r * Math.sin(theta) }
}

export interface SampleFieldOptions {
  signal?: AbortSignal
}

/**
 * Draw `count` area-uniform points from `region`, reusing `@mindpeeker/oracle`'s
 * exact bit reader so the coordinates carry no modulo or rounding bias. Returns
 * the points plus an honest {@link EntropyAccounting} receipt (bytes/bits the
 * draw spent). Deterministic: the same input bytes always give the same field.
 *
 * A field drawn this way is, by construction, a realization of **complete
 * spatial randomness** (CSR) — that is the null everything else in this package
 * tests against.
 */
export async function sampleField(
  source: OracleInput,
  count: number,
  region: FieldRegion,
  opts: SampleFieldOptions = {},
): Promise<{ points: readonly Point[]; accounting: EntropyAccounting }> {
  if (!Number.isInteger(count) || count < 1) {
    throw new FieldError('invalid_config', `count must be an integer ≥ 1, got ${count}`)
  }
  validateRegion(region)
  const reader = byteReader(source, opts.signal ? { signal: opts.signal } : {})
  const bits = bitReader(reader)
  const start = reader.bytesConsumed
  const points: Point[] = []
  try {
    for (let i = 0; i < count; i++) points.push(await samplePoint(bits, region))
  } catch (error) {
    rethrowOracle(error)
  }
  const bytesConsumed = reader.bytesConsumed - start
  return {
    points: Object.freeze(points),
    accounting: Object.freeze({ bytesConsumed, bitsUsed: bits.bitsUsed }),
  }
}
