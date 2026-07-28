// Package catalog for the nav + landing grid. `ready` gates which pages exist
// (this is a work-in-progress Nuxt rebuild; gematria is the flagship).

export interface PackageEntry {
  readonly id: string
  readonly pkg: string
  readonly title: string
  readonly tagline: string
  readonly group: 'randomness' | 'frontier' | 'tools'
  readonly ready?: boolean
}

export const PACKAGES: readonly PackageEntry[] = [
  {
    id: 'gematria',
    pkg: '@mindpeeker/gematria',
    title: 'Gematria',
    tagline:
      '31 exact-integer ciphers across Hebrew, Greek, Arabic and English/Latin — with reverse as a parameter.',
    group: 'frontier',
    ready: true,
  },
  { id: 'visualizer', pkg: '@mindpeeker/visualizer', title: 'Visualizer', tagline: 'WebGL2 dashboard driven by in-browser entropy.', group: 'tools' },
  { id: 'oracle', pkg: '@mindpeeker/oracle', title: 'Oracle', tagline: 'I-Ching, Tarot, runes and geomancy from an entropy stream.', group: 'frontier' },
  { id: 'rate', pkg: '@mindpeeker/rate', title: 'Rate', tagline: 'Malcolm Rae base-44 radionic rate cards as SVG.', group: 'frontier' },
  { id: 'field', pkg: '@mindpeeker/field', title: 'Field', tagline: 'Spatial point fields with attractor/void detection.', group: 'frontier' },
  { id: 'negentropy', pkg: '@mindpeeker/negentropy', title: 'Negentropy', tagline: 'Randomness health estimators and GCP statistics.', group: 'randomness' },
  { id: 'entropy', pkg: '@mindpeeker/entropy', title: 'Entropy', tagline: 'Provider-pluggable QRNG/TRNG/beacon randomness.', group: 'randomness' },
  { id: 'flow', pkg: '@mindpeeker/flow', title: 'Flow', tagline: 'Transfer entropy and directed information flow.', group: 'randomness' },
  { id: 'psi', pkg: '@mindpeeker/psi', title: 'Psi', tagline: 'PEAR-style mind-matter protocols and Bayes factors.', group: 'frontier' },
  { id: 'scan', pkg: '@mindpeeker/scan', title: 'Scan', tagline: 'Honest radionic scanning with a chance-deviation null.', group: 'frontier' },
  { id: 'vdf', pkg: '@mindpeeker/vdf', title: 'VDF', tagline: 'Pietrzak verifiable delay function over RSA-2048.', group: 'randomness' },
]

export const GROUP_LABELS: Record<PackageEntry['group'], string> = {
  randomness: 'Randomness engineering',
  frontier: 'Frontier & encoding',
  tools: 'Tools',
}

export const REPO_URL = 'https://github.com/Polobase/mindpeeker-sdk'
