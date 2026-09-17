import type { BitReader } from '@mindpeeker/oracle'
import { FieldError, toFieldError } from '../errors.js'
import { drawPoint, type FieldInput, uint32FromBits, withFieldReader } from '../internal/draw.js'
import { checkInteger, checkOptions, checkSignal } from '../internal/validate.js'
import { type EntropyAccounting, type FieldRegion, type Point, validateRegion } from '../types.js'

/**
 * One area-uniform point in the region from a bit reader (two 32-bit
 * coordinates: rect $x = uW, y = vH$; disk $r = R\sqrt u$, $\theta = 2\pi v$).
 *
 * @throws FieldError `invalid_config` for a bad region or a non-bit-reader
 */
export async function samplePoint(bits: BitReader, region: FieldRegion): Promise<Point> {
  validateRegion(region)
  if (bits === null || typeof bits !== 'object' || typeof bits.nextBits !== 'function') {
    throw new FieldError('invalid_config', 'samplePoint needs an oracle BitReader')
  }
  try {
    return await drawPoint(uint32FromBits(bits), region)
  } catch (error) {
    throw toFieldError(error)
  }
}

export interface SampleFieldOptions {
  /** Aborts the draw with `FieldError('aborted')`. */
  signal?: AbortSignal
}

/**
 * Draw `count` area-uniform points from `region`, reusing `@mindpeeker/oracle`'s
 * exact bit reader so the coordinates carry no modulo or rounding bias. Returns
 * the points plus an honest {@link EntropyAccounting} receipt (bytes/bits the
 * draw spent). Deterministic: the same input bytes always give the same field.
 *
 * `source` is any oracle input (batch, stream, `ByteSource`) or an existing
 * `ByteReader`. A reader this call creates is closed before it returns, so a
 * live provider's session is released; a `ByteReader` you pass stays open
 * and advances — pass one reader to several calls to keep their bytes
 * disjoint.
 *
 * A field drawn this way is, by construction, a realization of **complete
 * spatial randomness** (CSR) — that is the null everything else in this package
 * tests against.
 *
 * @throws FieldError `invalid_config` (count, region, input shape),
 *   `insufficient_entropy` (a finite input ran out), `aborted`, `source_error`
 */
export async function sampleField(
  source: FieldInput,
  count: number,
  region: FieldRegion,
  opts: SampleFieldOptions = {},
): Promise<{ points: readonly Point[]; accounting: EntropyAccounting }> {
  checkInteger(count, 'count', 1, 10_000_000)
  validateRegion(region)
  checkOptions(opts, 'sampleField')
  const signal = checkSignal(opts.signal)
  const { value: points, accounting } = await withFieldReader(source, signal, async (draw) => {
    const out: Point[] = new Array(count)
    for (let i = 0; i < count; i++) out[i] = await drawPoint(draw, region)
    return out
  })
  return { points: Object.freeze(points), accounting }
}
