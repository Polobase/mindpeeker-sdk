import { OracleError } from '../../errors.js'
import { SPREADS, type Spread, type SpreadName, type SpreadPosition, TAROT_DECK } from './data.js'

const invalid = (message: string) => new OracleError('invalid_spread', message)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Resolve a spread name or validate a custom spread object at the public
 * boundary. Built-in spreads are returned as-is (already deeply frozen); a
 * custom spread is returned as a frozen defensive copy (own properties
 * shallow-copied, `positions` array and each position copied and frozen), so
 * a stored reading cannot change when the caller later mutates its object.
 *
 * @throws OracleError `'invalid_spread'` for an unknown name (inherited keys
 *   such as `'constructor'` included), a non-object spread, a spread whose
 *   `id`/`name` is not a string, whose `positions` is not an array of
 *   `{ name: string, meaning: string }`, or that has fewer than 1 or more
 *   than 78 positions
 */
export function resolveSpread(spreadOrName: SpreadName | Spread): Spread {
  if (typeof spreadOrName === 'string') {
    if (!Object.hasOwn(SPREADS, spreadOrName)) {
      throw invalid(`unknown spread '${spreadOrName}'`)
    }
    return SPREADS[spreadOrName]
  }
  if (!isRecord(spreadOrName)) {
    throw invalid(`spread must be a spread name or a spread object, got ${String(spreadOrName)}`)
  }
  if (Object.values(SPREADS).includes(spreadOrName)) return spreadOrName
  const { id, name, positions } = spreadOrName as Record<keyof Spread, unknown>
  if (typeof id !== 'string' || typeof name !== 'string') {
    throw invalid('spread id and name must be strings')
  }
  if (!Array.isArray(positions)) throw invalid('spread positions must be an array')
  const count = positions.length
  if (count < 1 || count > TAROT_DECK.length) {
    throw invalid(`spread must have between 1 and ${TAROT_DECK.length} positions, got ${count}`)
  }
  // Array.from visits holes of a sparse array (as undefined), unlike map.
  const copies: SpreadPosition[] = Array.from(positions, (position: unknown, i) => {
    if (
      !isRecord(position) ||
      typeof position.name !== 'string' ||
      typeof position.meaning !== 'string'
    ) {
      throw invalid(`spread position ${i} must be { name: string, meaning: string }`)
    }
    return Object.freeze({ ...position }) as unknown as SpreadPosition
  })
  return Object.freeze({ ...spreadOrName, positions: Object.freeze(copies) })
}
