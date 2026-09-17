/**
 * The sixteen principal figures (*odu*) of Ifá divination, after William
 * Bascom, *Ifa Divination: Communication between Gods and Men in West
 * Africa* (Indiana University Press, 1969), Table 1 and Table 3.
 *
 * A figure is four marks read top to bottom, each a **single** mark (I) or a
 * **double** mark (II). `binary` encodes them with single = `'1'`, double =
 * `'0'` — the same convention as the geomantic figures' `binary` (1 = one
 * point), so the two tables share their sixteen shapes. The marks agree
 * with Frisvold's independent listing ("The Invisible City in the Realm of
 * Mystery", in *At the Crossroads*, 2012, pp. 24–28).
 *
 * **Rank order is lineage-dependent.** The array order and `rank.ife` are
 * the order "recognized at Ifẹ" that Bascom follows (confirmed for Ifẹ,
 * Ileṣa, and Igbomina); `rank.southwestern` is the "more widely recognized"
 * order of Lagos, Abẹokuta, and Ibadan (Table 3 B), which moves Irosun and
 * Ọwọnrin before Ọbara and Ọkanran and reverses Irẹtẹ, Otura, Oturupọn, Ika.
 * Bascom records twenty-one other rankings. The order matters for answering
 * questions by specific alternatives, not for a cast's probabilities.
 */

/** One principal odu. */
export interface OduFigure {
  /** Lowercase ASCII id: `ogbe`, `oyeku`, … */
  readonly id: string
  /** ASCII name as commonly written, e.g. 'Oyeku' (Edi is also written Odi). */
  readonly name: string
  /** Bascom's Yoruba spelling with subdots, tone marks omitted, e.g. 'Ọyẹku'. */
  readonly yoruba: string
  /** Four marks top → bottom, `'1'` = single mark (I), `'0'` = double (II). */
  readonly binary: string
  /** 1-based rank in each documented order. */
  readonly rank: { readonly ife: number; readonly southwestern: number }
}

// [id, name, yoruba, binary top→bottom, rank southwestern] in Ifẹ order (Bascom Table 1 / 3 A).
const ROWS: readonly (readonly [string, string, string, string, number])[] = [
  ['ogbe', 'Ogbe', 'Ogbe', '1111', 1],
  ['oyeku', 'Oyeku', 'Ọyẹku', '0000', 2],
  ['iwori', 'Iwori', 'Iwori', '0110', 3],
  ['edi', 'Edi', 'Edi', '1001', 4],
  ['obara', 'Obara', 'Ọbara', '1000', 7],
  ['okanran', 'Okanran', 'Ọkanran', '0001', 8],
  ['irosun', 'Irosun', 'Irosun', '1100', 5],
  ['owonrin', 'Owonrin', 'Ọwọnrin', '0011', 6],
  ['ogunda', 'Ogunda', 'Ogunda', '1110', 9],
  ['osa', 'Osa', 'Ọsa', '0111', 10],
  ['irete', 'Irete', 'Irẹtẹ', '1101', 14],
  ['otura', 'Otura', 'Otura', '1011', 13],
  ['oturupon', 'Oturupon', 'Oturupọn', '0010', 12],
  ['ika', 'Ika', 'Ika', '0100', 11],
  ['ose', 'Ose', 'Ọṣẹ', '1010', 15],
  ['ofun', 'Ofun', 'Ofun', '0101', 16],
]

/** The sixteen principal odu in the Ifẹ order Bascom (1969) follows. */
export const ODU_FIGURES: readonly OduFigure[] = Object.freeze(
  ROWS.map(([id, name, yoruba, binary, southwestern], i) =>
    Object.freeze({ id, name, yoruba, binary, rank: Object.freeze({ ife: i + 1, southwestern }) }),
  ),
)

const BY_BINARY: ReadonlyMap<string, OduFigure> = new Map(ODU_FIGURES.map((f) => [f.binary, f]))

/**
 * Look up a principal odu by its four marks (top → bottom, `'1'` = single).
 * Returns `undefined` for anything that is not one of the 16 keys.
 */
export function oduFromBinary(binary: string): OduFigure | undefined {
  return BY_BINARY.get(binary)
}
