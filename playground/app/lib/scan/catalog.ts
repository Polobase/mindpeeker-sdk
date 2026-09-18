// Catalog helpers for the scan page. CLIENT-ONLY (imports @mindpeeker/scan).

import { type Catalog, type CatalogItem, defineCatalog } from '@mindpeeker/scan'

/** A short, neutral default catalog — intentions, not remedies: no medical claim. */
export const DEFAULT_CATALOG_TEXT = [
  'Rest',
  'Movement',
  'Water',
  'Fire',
  'Focus',
  'Release',
  'Grounding',
  'Clarity',
  'Balance',
  'Vitality',
  'Patience',
  'Attention',
].join('\n')

/** Non-empty trimmed lines of a textarea, in order. */
export function catalogLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** Names that occur more than once (in first-seen order). */
export function duplicateNames(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const name of names) {
    if (seen.has(name)) dup.add(name)
    else seen.add(name)
  }
  return [...dup]
}

/** Drop repeats, keeping the first occurrence. */
export function dedupeNames(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of names) {
    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/**
 * Build a catalog from plain names. With `dedupe: false` a repeated line reaches
 * `defineCatalog`, which rejects it with `ScanError('invalid_catalog')` — the
 * typed error the page shows on purpose.
 */
export function buildCatalog(
  id: string,
  name: string,
  names: readonly string[],
  opts: { dedupe?: boolean } = {},
): Catalog {
  const list = opts.dedupe === false ? [...names] : dedupeNames(names)
  const items: CatalogItem[] = list.map((itemName) => ({ name: itemName }))
  return defineCatalog(id, name, items)
}

/** `item-1 … item-n` — a synthetic family for the null-model demos. */
export function syntheticCatalog(id: string, count: number): Catalog {
  return defineCatalog(
    id,
    `${count} synthetic items`,
    Array.from({ length: count }, (_, i) => ({ id: `item-${i + 1}`, name: `Item ${i + 1}` })),
  )
}
