// The package catalog that drives the nav, the landing card grid, and page
// headers. `id` is the page slug (folder under site/ and nav key).

export interface PackageEntry {
  readonly id: string
  readonly pkg: string
  readonly title: string
  readonly tagline: string
  readonly group: 'randomness' | 'frontier' | 'tools'
}

export const PACKAGES: readonly PackageEntry[] = [
  {
    id: 'gematria',
    pkg: '@mindpeeker/gematria',
    title: 'Gematria',
    tagline:
      '41 exact-integer ciphers across Hebrew, Greek, Arabic and English/Latin — including Peter Plichta’s Prime Number Cross.',
    group: 'frontier',
  },
  {
    id: 'visualizer',
    pkg: '@mindpeeker/visualizer',
    title: 'Visualizer',
    tagline:
      'A WebGL2 dashboard for live byte streams and randomness statistics — driven entirely by in-browser entropy, no server.',
    group: 'tools',
  },
  {
    id: 'oracle',
    pkg: '@mindpeeker/oracle',
    title: 'Oracle',
    tagline:
      'Bias-free draws from an entropy stream: I-Ching, Tarot, Elder Futhark runes and geomancy, with exact probabilities.',
    group: 'frontier',
  },
  {
    id: 'rate',
    pkg: '@mindpeeker/rate',
    title: 'Rate',
    tagline:
      'Malcolm Rae base-44 radionic rates: parse a rate, render its SVG card, and read each digit’s phase angle.',
    group: 'frontier',
  },
  {
    id: 'field',
    pkg: '@mindpeeker/field',
    title: 'Field',
    tagline:
      'Unbiased spatial point fields with attractor/void detection and Ripley’s K/L against a complete-spatial-randomness null.',
    group: 'frontier',
  },
  {
    id: 'negentropy',
    pkg: '@mindpeeker/negentropy',
    title: 'Negentropy',
    tagline:
      'Order detection and randomness health: entropy estimators, GCP-style network statistics, and extractors.',
    group: 'randomness',
  },
  {
    id: 'entropy',
    pkg: '@mindpeeker/entropy',
    title: 'Entropy',
    tagline:
      'Provider-pluggable QRNG/TRNG/beacon randomness with SP 800-90B health tests, conditioning, and mixing strategies.',
    group: 'randomness',
  },
  {
    id: 'flow',
    pkg: '@mindpeeker/flow',
    title: 'Flow',
    tagline:
      'Transfer entropy and directed information flow for symbol streams, with surrogate significance testing.',
    group: 'randomness',
  },
  {
    id: 'psi',
    pkg: '@mindpeeker/psi',
    title: 'Psi',
    tagline:
      'Mind-matter-interaction protocols: PEAR-style tripolar runs, GCP event analysis, Bayes factors and surrogate nulls.',
    group: 'frontier',
  },
  {
    id: 'scan',
    pkg: '@mindpeeker/scan',
    title: 'Scan',
    tagline:
      'Honest radionic scanning + broadcasting with a real chance-deviation null model and a tripolar MMI protocol.',
    group: 'frontier',
  },
  {
    id: 'vdf',
    pkg: '@mindpeeker/vdf',
    title: 'VDF',
    tagline:
      'A Pietrzak verifiable delay function over RSA-2048: sequential-squaring time-locks with O(log T) proofs.',
    group: 'randomness',
  },
]

export const GROUP_LABELS: Record<PackageEntry['group'], string> = {
  randomness: 'Randomness engineering',
  frontier: 'Frontier & encoding',
  tools: 'Tools',
}

export const REPO_URL = 'https://github.com/Polobase/mindpeeker-sdk'

/** Base-aware URL for a page id (respects Vite's configured base path). */
export function pageHref(id: string): string {
  const base = import.meta.env.BASE_URL
  return id === '' ? base : `${base}${id}/`
}
