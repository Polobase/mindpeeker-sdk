import { dialToBase44, parseRate, type Rate } from '@mindpeeker/rate'
import { ScanError } from './errors.js'
import type { Catalog, CatalogItem } from './types.js'

/**
 * Assemble a frozen {@link Catalog}. Validates that `items` is non-empty and
 * every item has a non-empty `name`; each item (and the catalog) is deeply
 * frozen so a scan can never mutate its input.
 *
 * @throws {ScanError} `invalid_catalog` on an empty list or a nameless item.
 */
export function defineCatalog(id: string, name: string, items: readonly CatalogItem[]): Catalog {
  if (!Array.isArray(items) || items.length === 0) {
    throw new ScanError('invalid_catalog', `catalog "${id}" must have at least one item`)
  }
  const frozen = items.map((item, i) => {
    if (typeof item.name !== 'string' || item.name.length === 0) {
      throw new ScanError('invalid_catalog', `catalog "${id}" item ${i} has no name`)
    }
    return Object.freeze({
      id: item.id ?? item.name,
      name: item.name,
      ...(item.category !== undefined && { category: item.category }),
      ...(item.rate !== undefined && { rate: Object.freeze(item.rate) }),
    })
  })
  return Object.freeze({ id, name, items: Object.freeze(frozen) })
}

/**
 * The rate systems a frontend `RateEntry` may carry, mirrored structurally so
 * this package need not depend on the frontend. Every field is optional — the
 * bridge is tolerant of missing systems.
 */
export interface RateEntrySystems {
  /** De La Warr base-10 digit string, e.g. `'149'`. */
  delawarr?: string
  /** De La Warr two-dial bridge string. */
  delawarrTwoDial?: string
  /** KRT / Hieronymus two-dial 0..100, e.g. `{ rate: '62.00-38.00' }`. */
  krt?: { rate?: string }
  /** Combe multi-base, e.g. `{ base10: '23344', base44: '05 09 12 14 16' }`. */
  combe?: { base10?: string; base44?: string; base336?: string }
  /** Copen homoeopathic base-10 digit string. */
  copenHomeo?: string
  /** Copen organs & symptoms base-10 digit string. */
  copenOrgan?: string
}

/** A frontend rate-index entry, mirrored structurally (see `RateEntrySystems`). */
export interface RateEntryLike {
  term: string
  slug?: string
  systems?: RateEntrySystems
  categories?: readonly string[]
}

/** Split a base-10 digit string like `'23344'` into `[2,3,3,4,4]`. */
function base10Digits(s: string): number[] | undefined {
  if (!/^\d+$/.test(s)) return undefined
  return [...s].map((c) => c.charCodeAt(0) - 48)
}

/**
 * Resolve one {@link RateEntrySystems} to a base-44 {@link Rate}, preferring
 * the cleanest, best-defined encoding available:
 *
 * 1. `combe.base10` → `dialToBase44` (a clean base-10 dial projection).
 * 2. `delawarr` / `copenHomeo` / `copenOrgan` (base-10 dials) → `dialToBase44`.
 * 3. `krt.rate` (two-dial 0..100) → each dial's integer part as a base-100
 *    digit, projected to base 44 via `convertBase` inside `dialToBase44`.
 * 4. `combe.base44` (the Combe book's own space-separated base-44 labels) →
 *    `parseRate` at base 44 — used last because that field is not internally
 *    consistent across the source data (it mixes 0- and 1-based labels), so we
 *    only trust it when nothing better exists and skip it if any label is out
 *    of range.
 *
 * Returns `undefined` when no system resolves — the caller keeps the item
 * without a rate.
 */
export function rateFromSystems(systems: RateEntrySystems | undefined): Rate | undefined {
  if (!systems) return undefined
  const tryDial = (s: string | undefined): Rate | undefined => {
    if (!s) return undefined
    const digits = base10Digits(s)
    if (!digits || digits.length === 0) return undefined
    try {
      return dialToBase44(digits).rate
    } catch {
      return undefined
    }
  }
  const fromCombe10 = tryDial(systems.combe?.base10)
  if (fromCombe10) return fromCombe10
  const fromDial =
    tryDial(systems.delawarr) ?? tryDial(systems.copenHomeo) ?? tryDial(systems.copenOrgan)
  if (fromDial) return fromDial
  const krt = systems.krt?.rate
  if (krt) {
    // '62.00-38.00' → integer dial parts 62, 38 read as base-100, then to 44.
    const hundreds = krt.split('-').map((g) => {
      const v = Math.round(Number.parseFloat(g))
      return Number.isFinite(v) ? ((v % 100) + 100) % 100 : Number.NaN
    })
    if (hundreds.length > 0 && hundreds.every((d) => Number.isFinite(d))) {
      try {
        return dialToBase44(hundreds, { fromBase: 100 }).rate
      } catch {
        // fall through to base44
      }
    }
  }
  const base44 = systems.combe?.base44
  if (base44) {
    try {
      return parseRate(base44.trim().replace(/\s+/g, '-'), { base: 44 })
    } catch {
      return undefined
    }
  }
  return undefined
}

/** Options for {@link catalogFromRateEntries}. */
export interface CatalogFromEntriesOptions {
  id?: string
  name?: string
}

/**
 * Bridge frontend `RateEntry` rows into a scannable {@link Catalog}. Each
 * entry's `term` becomes an item name, its first `categories` entry the
 * category, and its `systems` resolve to a base-44 rate via
 * {@link rateFromSystems} (tolerant of missing or malformed systems — an
 * unresolvable entry becomes an item with no rate, never a thrown error).
 *
 * @throws {ScanError} `invalid_catalog` if `entries` is empty.
 */
export function catalogFromRateEntries(
  entries: readonly RateEntryLike[],
  opts: CatalogFromEntriesOptions = {},
): Catalog {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new ScanError('invalid_catalog', 'catalogFromRateEntries needs at least one entry')
  }
  const items: CatalogItem[] = entries
    .filter((e) => typeof e.term === 'string' && e.term.length > 0)
    .map((e) => {
      const rate = rateFromSystems(e.systems)
      const category = e.categories?.[0]
      return {
        id: e.slug ?? e.term,
        name: e.term,
        ...(category !== undefined && { category }),
        ...(rate !== undefined && { rate }),
      }
    })
  return defineCatalog(opts.id ?? 'rate-index', opts.name ?? 'Rate index', items)
}
