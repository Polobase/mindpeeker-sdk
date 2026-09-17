import { OracleError } from '../../errors.js'
import { type Hexagram, hexagramFromBinary } from './data.js'

/**
 * Structural relations between hexagrams — pure functions of the six line
 * bits (bottom → top, yang = 1; `binary[0]` is line 1). No entropy involved.
 */

/** Resolve a hexagram-shaped value by its `binary` key (JSON round-trips accepted). */
function canonical(value: unknown, fn: string): Hexagram {
  const binary =
    typeof value === 'object' && value !== null ? (value as { binary?: unknown }).binary : undefined
  const hexagram = typeof binary === 'string' ? hexagramFromBinary(binary) : undefined
  if (hexagram === undefined) {
    throw new OracleError('invalid_input', `${fn} expects a hexagram`)
  }
  return hexagram
}

const lookup = (binary: string): Hexagram => hexagramFromBinary(binary) as Hexagram

/**
 * The nuclear (inner) hexagram: lines 2–4 become the lower trigram and
 * lines 3–5 the upper, $$\text{nuclear} = (b_2, b_3, b_4, b_3, b_4, b_5).$$
 * Only 16 hexagrams are nuclear, and applying the map twice always lands on
 * #1, #2, #63, or #64 (it depends on $b_3 b_4$ alone). E.g. the nuclear
 * hexagram of #63 After Completion is #64 Before Completion.
 *
 * @throws OracleError `'invalid_input'` when `hexagram` is not a hexagram
 */
export function nuclearHexagram(hexagram: Hexagram): Hexagram {
  const { binary } = canonical(hexagram, 'nuclearHexagram')
  return lookup(binary.slice(1, 4) + binary.slice(2, 5))
}

/**
 * The inverse hexagram: the figure turned upside down (rotated 180°), line
 * $k$ ↦ line $7 - k$. The King Wen sequence is built from these pairs: for
 * every odd $k$, #$k{+}1$ is the inverse of #$k$ — except for the four
 * self-inverse pairs (1/2, 27/28, 29/30, 61/62), which are complements
 * ({@link oppositeHexagram}) instead.
 *
 * @throws OracleError `'invalid_input'` when `hexagram` is not a hexagram
 */
export function inverseHexagram(hexagram: Hexagram): Hexagram {
  const { binary } = canonical(hexagram, 'inverseHexagram')
  return lookup([...binary].reverse().join(''))
}

/**
 * The opposite (complementary) hexagram: every line changed, yang ↔ yin —
 * the relating hexagram of a cast in which all six lines move.
 *
 * @throws OracleError `'invalid_input'` when `hexagram` is not a hexagram
 */
export function oppositeHexagram(hexagram: Hexagram): Hexagram {
  const { binary } = canonical(hexagram, 'oppositeHexagram')
  return lookup([...binary].map((bit) => (bit === '1' ? '0' : '1')).join(''))
}

/**
 * The binary (Fu Xi / "Earlier Heaven") number of a hexagram, in $[0, 63]$:
 * yin = 0, yang = 1, **line 1 (bottom) most significant**, i.e.
 * $\sum_{k=1}^{6} b_k \, 2^{6-k}$ — Kun #2 = 0, Bo #23 = 1, Bi #8 = 2, …,
 * Qian #1 = 63. This is Shao Yong's doubling order (each added line doubles
 * the sequence, so the first line is the most significant), whose reading
 * as 0–63 Leibniz published in 1703. The traditional Fu Xi sequence lists
 * the figures from Qian downward: position $64 - n$ (Qian 1st, Guai 2nd,
 * Da You 3rd, …, Kun 64th).
 *
 * @throws OracleError `'invalid_input'` when `hexagram` is not a hexagram
 */
export function fuXiNumber(hexagram: Hexagram): number {
  return Number.parseInt(canonical(hexagram, 'fuXiNumber').binary, 2)
}

/**
 * Inverse of {@link fuXiNumber}.
 *
 * @throws OracleError `'invalid_input'` unless `n` is an integer in $[0, 63]$
 */
export function hexagramFromFuXi(n: number): Hexagram {
  if (!Number.isInteger(n) || n < 0 || n > 63) {
    throw new OracleError('invalid_input', `Fu Xi number must be an integer in [0, 63], got ${n}`)
  }
  return lookup(n.toString(2).padStart(6, '0'))
}
