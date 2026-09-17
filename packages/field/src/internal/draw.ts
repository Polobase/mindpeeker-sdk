import { type BitReader, type ByteReader, byteReader, type OracleInput } from '@mindpeeker/oracle'
import { FieldError, toFieldError } from '../errors.js'
import type { EntropyAccounting, FieldRegion, Point } from '../types.js'
import { compareXY } from './neighbours.js'

/** Anything the package can draw entropy from: an oracle input or an existing byte reader. */
export type FieldInput = OracleInput | ByteReader

const TWO_32 = 2 ** 32

/** A 32-bit draw source: MSB-first, so bytes and bits give identical values. */
export type Uint32Draw = () => Promise<number>

/** Big-endian 32-bit integers from whole bytes (5× faster than a bit reader; same values). */
export function uint32FromBytes(reader: ByteReader): Uint32Draw {
  return async () => {
    const b0 = await reader.next()
    const b1 = await reader.next()
    const b2 = await reader.next()
    const b3 = await reader.next()
    return b0 * 16777216 + ((b1 << 16) | (b2 << 8) | b3)
  }
}

/** 32-bit integers from a caller's bit reader (which may sit mid-byte). */
export function uint32FromBits(bits: BitReader): Uint32Draw {
  return () => bits.nextBits(32)
}

/** A uniform float in [0, 1) from 32 fresh bits — exact, no rejection. */
export async function unitFloat(draw: Uint32Draw): Promise<number> {
  return (await draw()) / TWO_32
}

/** One area-uniform point in a validated region (two 32-bit coordinates). */
export async function drawPoint(draw: Uint32Draw, region: FieldRegion): Promise<Point> {
  if (region.kind === 'rect') {
    const x = (await unitFloat(draw)) * region.width
    const y = (await unitFloat(draw)) * region.height
    return { x, y }
  }
  // area-uniform disk: r = R√u keeps density flat (r ∝ √u, not u)
  const r = region.radius * Math.sqrt(await unitFloat(draw))
  const theta = 2 * Math.PI * (await unitFloat(draw))
  return { x: r * Math.cos(theta), y: r * Math.sin(theta) }
}

/**
 * Run `body` against a byte reader over `input`, owning the reader's
 * lifecycle: a reader this call creates (from a batch, stream, or
 * `ByteSource`) is closed in `finally`, so a live provider's stream is
 * released whether the body resolves, throws, or is aborted; a
 * caller-supplied `ByteReader` stays open (with `signal`, the body reads
 * through an abortable view of it). Every failure is mapped to a
 * {@link FieldError}.
 */
export async function withFieldReader<T>(
  input: FieldInput,
  signal: AbortSignal | undefined,
  body: (draw: Uint32Draw) => Promise<T>,
): Promise<{ readonly value: T; readonly accounting: EntropyAccounting }> {
  let reader: ByteReader
  try {
    reader = byteReader(input, signal ? { signal } : {})
  } catch (error) {
    throw toFieldError(error)
  }
  const startConsumed = reader.bytesConsumed
  const startFetched = reader.bytesFetched
  try {
    const value = await body(uint32FromBytes(reader))
    const fetched = reader.bytesFetched
    const bytesConsumed = reader.bytesConsumed - startConsumed
    const accounting: EntropyAccounting = Object.freeze({
      bytesConsumed,
      bitsUsed: 8 * bytesConsumed, // every draw here is a whole 32-bit integer
      ...(fetched !== undefined && startFetched !== undefined
        ? { bytesFetched: fetched - startFetched }
        : {}),
    })
    return { value, accounting }
  } catch (error) {
    throw toFieldError(error)
  } finally {
    if (reader !== input) await reader.close()
  }
}

function coordinateKey(p: Point): string {
  return `${p.x},${p.y}`
}

/** Detects a simulated field that replays the observed one (same points, any order). */
export class ReplayGuard {
  readonly #keys: Set<string>
  readonly #sorted: Point[]

  constructor(observed: readonly Point[]) {
    this.#keys = new Set(observed.map(coordinateKey))
    this.#sorted = [...observed].sort(compareXY)
  }

  /** @throws FieldError `invalid_config` when `field` holds exactly the observed points */
  check(field: readonly Point[], run: number): void {
    const first = field[0]
    if (first === undefined || !this.#keys.has(coordinateKey(first))) return
    if (field.length !== this.#sorted.length) return
    const sorted = [...field].sort(compareXY)
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i] as Point
      const b = this.#sorted[i] as Point
      if (a.x !== b.x || a.y !== b.y) return
    }
    throw new FieldError(
      'invalid_config',
      `simulation ${run} replayed the observed field: the entropy input restarted ` +
        '(a recorded batch or a restarting source); draw the null fields from fresh bytes',
    )
  }
}

/**
 * Draw `runs` complete-spatial-randomness fields of `n` points from one
 * advancing reader over `input`, handing each to `onField`. With `observed`,
 * a field identical to the observed pattern throws `invalid_config` — the
 * signature of a replayed batch or restarting source, which would make any
 * Monte-Carlo test powerless.
 */
export async function drawNullFields(
  input: FieldInput,
  n: number,
  region: FieldRegion,
  runs: number,
  opts: {
    readonly signal?: AbortSignal | undefined
    readonly observed?: readonly Point[] | undefined
    readonly onField: (points: readonly Point[], run: number) => void
  },
): Promise<EntropyAccounting> {
  const guard = opts.observed ? new ReplayGuard(opts.observed) : undefined
  const { accounting } = await withFieldReader(input, opts.signal, async (draw) => {
    for (let run = 0; run < runs; run++) {
      const points: Point[] = new Array(n)
      for (let i = 0; i < n; i++) points[i] = await drawPoint(draw, region)
      guard?.check(points, run)
      opts.onField(points, run)
    }
  })
  return accounting
}
