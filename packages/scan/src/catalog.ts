import { dialToBase44, parseRate, type Rate } from '@mindpeeker/rate'
import { ScanError } from './errors.js'
import { frozenRate } from './internal/rate.js'
import type { Catalog, CatalogItem } from './types.js'

function optionalString(value: unknown, what: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) {
    throw new ScanError('invalid_catalog', `${what} must be a non-empty string`)
  }
  return value
}

/**
 * Assemble a frozen {@link Catalog}. Validates that `items` is non-empty,
 * every item has a non-empty `name`, ids (`id ?? name`) are unique, names are
 * unique within a category, and any `rate` passes `@mindpeeker/rate`'s own
 * checks. The catalog, its items, and each rate are **defensive copies**,
 * deeply frozen — the caller's objects are neither kept nor frozen, so a scan
 * can never see a later mutation of its input.
 *
 * Unique ids matter: every result row carries its item's `id`, and ties in
 * the ranking break on a hash of the id — a duplicate would make rows
 * unmappable and reintroduce catalog-order ranking.
 *
 * @throws {ScanError} `invalid_catalog` on an empty list, a nameless or
 *   malformed item, a duplicate id, a duplicate name within one category, or
 *   an invalid rate.
 */
export function defineCatalog(id: string, name: string, items: readonly CatalogItem[]): Catalog {
  if (typeof id !== 'string' || id.length === 0) {
    throw new ScanError('invalid_catalog', 'catalog id must be a non-empty string')
  }
  if (typeof name !== 'string') {
    throw new ScanError('invalid_catalog', `catalog "${id}" name must be a string`)
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new ScanError('invalid_catalog', `catalog "${id}" must have at least one item`)
  }
  const ids = new Set<string>()
  const names = new Set<string>()
  const frozen = items.map((item, i) => {
    if (typeof item !== 'object' || item === null) {
      throw new ScanError('invalid_catalog', `catalog "${id}" item ${i} is not an object`)
    }
    if (typeof item.name !== 'string' || item.name.length === 0) {
      throw new ScanError('invalid_catalog', `catalog "${id}" item ${i} has no name`)
    }
    const itemId = optionalString(item.id, `catalog "${id}" item ${i} id`) ?? item.name
    const category = optionalString(item.category, `catalog "${id}" item ${i} category`)
    if (ids.has(itemId)) {
      throw new ScanError('invalid_catalog', `catalog "${id}" has duplicate id "${itemId}"`)
    }
    ids.add(itemId)
    // JSON of the pair keeps (category, name) collision-free for any strings
    const nameKey = JSON.stringify([category ?? null, item.name])
    if (names.has(nameKey)) {
      throw new ScanError(
        'invalid_catalog',
        `catalog "${id}" has duplicate name "${item.name}" in ${category === undefined ? 'no category' : `category "${category}"`}`,
      )
    }
    names.add(nameKey)
    const rate =
      item.rate === undefined
        ? undefined
        : frozenRate(item.rate, 'invalid_catalog', `catalog "${id}" item "${itemId}" rate`)
    return Object.freeze({
      id: itemId,
      name: item.name,
      ...(category !== undefined && { category }),
      ...(rate !== undefined && { rate }),
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
  /**
   * De La Warr digit string, e.g. `'149'`, read one base-10 dial per
   * character. A secondary practitioner source (Wired Alchemy) says Drown and
   * Delawarr instruments have a 0–100 *master* dial first, which this
   * per-character reading does not model.
   */
  delawarr?: string
  /** De La Warr two-dial bridge string. */
  delawarrTwoDial?: string
  /**
   * KRT / Hieronymus dials 0.00–100.00, e.g. `{ rate: '62.00-38.00' }`. Real KRT
   * rates carry fractional settings (`'25.00-33.50'`) and treat `100.00` as a
   * distinct (fully meshed) setting; the base-44 projection below is lossy.
   */
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
 * 3. `krt.rate` (dials 0.00–100.00) → each dial *rounded* to an integer and
 *    reduced mod 100 as a base-100 digit, projected to base 44 via
 *    `convertBase` inside `dialToBase44`. This is a modeled projection, not
 *    the instrument's geometry: fractions are lost (`'62.75'` → 63) and
 *    `100.00` (fully meshed) collapses onto `0.00`.
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
 * unresolvable entry becomes an item with no rate, never a thrown error). The
 * item id is `slug ?? term`, so entries that share a term need distinct slugs.
 *
 * @throws {ScanError} `invalid_catalog` if `entries` is empty or ids collide
 *   (see {@link defineCatalog}).
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
