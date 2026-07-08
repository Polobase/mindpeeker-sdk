import { bitReader } from '../../core/bits.js'
import { type ByteReader, byteReader } from '../../core/reader.js'
import type { EntropyAccounting, OracleInput } from '../../types.js'
import { type FigureRow, figureFromBinary, type GeomanticFigure } from './data.js'

type Rows = readonly [FigureRow, FigureRow, FigureRow, FigureRow]

/** Four figures, e.g. the Mothers or the Daughters. */
export type FigureQuartet = readonly [
  GeomanticFigure,
  GeomanticFigure,
  GeomanticFigure,
  GeomanticFigure,
]

export interface ShieldCast extends EntropyAccounting {
  /** The four randomly generated figures — everything else is derived. */
  readonly mothers: FigureQuartet
  /** Daughter $k$ row $m$ = Mother $m$ row $k$ (transposition). */
  readonly daughters: FigureQuartet
  /** Row-wise "addition" of adjacent pairs: $M_1{+}M_2$, $M_3{+}M_4$, $D_1{+}D_2$, $D_3{+}D_4$. */
  readonly nieces: FigureQuartet
  /** Right Witness ($N_1{+}N_2$), Left Witness ($N_3{+}N_4$). */
  readonly witnesses: readonly [GeomanticFigure, GeomanticFigure]
  /** Right + Left Witness. Always one of the eight even-point figures. */
  readonly judge: GeomanticFigure
}

export interface CastShieldOptions {
  /** Aborts the cast with an OracleError `'aborted'`. */
  signal?: AbortSignal
}

/**
 * Geomantic addition: rows combine independently, and a row is active in
 * the sum iff the two parent rows' total point count is odd — with
 * active $= 1$ that is exactly $$r = a \oplus b,$$ the XOR of the parents'
 * activity bits (Greer, *The Art and Practice of Geomancy*, 2009, ch. 1).
 */
const add = (a: Rows, b: Rows): Rows =>
  a.map((row, i) => (row ^ (b[i] as number)) as FigureRow) as unknown as Rows

const toFigure = (rows: Rows): GeomanticFigure => figureFromBinary(rows.join('')) as GeomanticFigure

/**
 * Cast a full shield chart from exactly 16 MSB-first bits (2 bytes):
 * bit $4m + r$ is Mother $m{+}1$'s row $r$ (Fire, Air, Water, Earth), so
 * each of the $2^{16}$ mother combinations is exactly equiprobable.
 *
 * The derived chart follows the classical construction: Daughters by
 * transposing the Mothers' rows, then Nieces, Witnesses, and Judge by
 * pairwise geomantic addition. Because addition is XOR and every one of
 * the 16 mother/daughter rows enters the Judge an even number of times…
 * more precisely, the Judge equals the XOR of all four Mothers *and* all
 * four Daughters, and each original bit appears exactly twice in that sum —
 * the Judge always has an **even** point total (the classical validity
 * check: only the 8 even figures can judge).
 *
 * Entropy accounting is exact: `bytesConsumed: 2, bitsUsed: 16`, always.
 */
export async function castShield(
  input: OracleInput | ByteReader,
  opts: CastShieldOptions = {},
): Promise<ShieldCast> {
  const reader = byteReader(input, { signal: opts.signal })
  const startBytes = reader.bytesConsumed
  const bits = bitReader(reader)

  const motherRows: Rows[] = []
  for (let m = 0; m < 4; m++) {
    const rows: FigureRow[] = []
    for (let r = 0; r < 4; r++) rows.push(await bits.nextBit())
    motherRows.push(rows as unknown as Rows)
  }
  const daughterRows: Rows[] = [0, 1, 2, 3].map(
    (k) => motherRows.map((mother) => mother[k] as FigureRow) as unknown as Rows,
  )
  const nieceRows: Rows[] = [
    add(motherRows[0] as Rows, motherRows[1] as Rows),
    add(motherRows[2] as Rows, motherRows[3] as Rows),
    add(daughterRows[0] as Rows, daughterRows[1] as Rows),
    add(daughterRows[2] as Rows, daughterRows[3] as Rows),
  ]
  const right = add(nieceRows[0] as Rows, nieceRows[1] as Rows)
  const left = add(nieceRows[2] as Rows, nieceRows[3] as Rows)

  const quartet = (rows: Rows[]): FigureQuartet =>
    Object.freeze(rows.map(toFigure)) as unknown as FigureQuartet

  return Object.freeze({
    mothers: quartet(motherRows),
    daughters: quartet(daughterRows),
    nieces: quartet(nieceRows),
    witnesses: Object.freeze([
      toFigure(right),
      toFigure(left),
    ]) as unknown as ShieldCast['witnesses'],
    judge: toFigure(add(right, left)),
    bytesConsumed: reader.bytesConsumed - startBytes,
    bitsUsed: bits.bitsUsed,
  })
}

/**
 * Project a shield chart onto the twelve astrological houses in the
 * traditional order: houses 1–4 are the Mothers, 5–8 the Daughters, 9–12
 * the Nieces (Greer 2009, ch. 6). A pure projection — no entropy involved.
 */
export function houses(shield: ShieldCast): readonly GeomanticFigure[] {
  return Object.freeze([...shield.mothers, ...shield.daughters, ...shield.nieces])
}
