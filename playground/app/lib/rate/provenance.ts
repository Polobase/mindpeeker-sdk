// The README's verified-vs-modeled table as data. SSR-safe: no SDK imports, so
// an SSR-safe component may render it.

export type ProvenanceStatus = 'verified' | 'empirical' | 'web' | 'modeled'

export interface ProvenanceRow {
  readonly claim: string
  readonly status: ProvenanceStatus
  /** What separates this row from the one above it, in one line. */
  readonly detail: string
  readonly source: string
}

export const STATUS_META: Record<
  ProvenanceStatus,
  { label: string; color: 'success' | 'info' | 'warning' | 'neutral'; explain: string }
> = {
  verified: {
    label: 'Verified (printed)',
    color: 'success',
    explain: 'A printed source in the maintainers’ ark-db document library states it.',
  },
  empirical: {
    label: 'Empirical',
    color: 'info',
    explain: 'Measured from a real rate corpus, not quoted from anyone.',
  },
  web: {
    label: 'Web-sourced only',
    color: 'warning',
    explain:
      'Only practitioner web pages say it; no printed source found. Read it as tradition reporting itself.',
  },
  modeled: {
    label: 'Modeled here',
    color: 'neutral',
    explain:
      'This package’s clean parameterisation. Consistent with the sources, not stated by them.',
  },
}

export const PROVENANCE_ROWS: readonly ProvenanceRow[] = [
  {
    claim: 'Rae founded Magneto-Geometric Applications; the card system holds about 24,000 rates',
    status: 'verified',
    detail: 'Printed history of the instrument tradition.',
    source: 'ark-db: Swimming Through The Ether, pp. 4 and 16; radionics.co.uk',
  },
  {
    claim: 'Cards are concentric circles carrying partial radii; the pattern is the set of angles',
    status: 'verified',
    detail: 'The structural claim this whole package encodes.',
    source: 'radionics.co.uk (MGA-Rae); ark-db: Secrets in the Fields, p. 224',
  },
  {
    claim: 'Predecessor dial instruments (De La Warr, Copen) use base-10 dials, labelled 1–10',
    status: 'verified',
    detail: 'Base 10 from the rate books; the 1–10 labelling from a printed DIY manual.',
    source: 'wiredalchemy.com; ark-db: introtoorgonite4plus, p. 39',
  },
  {
    claim: 'Real base-44 rate books label digits 1..44 (one-based), about 5 digits per rate',
    status: 'empirical',
    detail: '65,311 of 65,500 Combe base-44 tokens land in 1..44 — hence the one-based switch.',
    source: 'frontend rate-index (Combe)',
  },
  {
    claim: 'Rae’s dates 1913–1979; electronic engineer; MGA work from the 1950s',
    status: 'web',
    detail: 'Printed sources give no dates and place the instrument concepts in the 1960s.',
    source: 'radionics.co.uk; wiredalchemy.com; ark-db: Radionics – Science of The Future, p. 1',
  },
  {
    claim: 'Base 44 as the "minimum calibrations to express every concept in the human entity"',
    status: 'web',
    detail:
      'The number 44 appears in no printed source we found; it is a dowsed answer, quoted by practitioners.',
    source: 'radionics.co.uk; wiredalchemy.com',
  },
  {
    claim: 'Angular resolution of "one degree of arc"; lines measured from 12 o’clock / north',
    status: 'web',
    detail: 'Qualitative only — it fixes the drawing convention, not the digit map.',
    source: 'radionics.co.uk; wiredalchemy card comments',
  },
  {
    claim: 'Combe’s base-10 / base-44 / "base-336" rate books; base-336 rates are digits 1–9',
    status: 'web',
    detail: '"336" is not a radix, so convertBase(rate, 336) is not a Combe rate. Not modelled.',
    source: 'wiredalchemy.com; psychotronics.org design document (2024)',
  },
  {
    claim: 'Digit → angle is exactly θ_d = d · 2π/44',
    status: 'modeled',
    detail:
      'A clean ℤ₄₄ → S¹ homomorphism consistent with "equal-angle radial lines". A 2024 practitioner document gives 360/44 ≈ 8.18° per step; no source attributes a per-digit formula to Rae.',
    source: 'this package; psychotronics.org design document (2024)',
  },
  {
    claim: 'One ring per digit, concentric inner → outer, with this ring spacing',
    status: 'modeled',
    detail:
      'Sources confirm rings and radii, not the digit ↔ ring assignment or the spacing. The 2024 document also says base-44 rates are written in non-decreasing order; parseRate does not enforce an order.',
    source: 'this package',
  },
  {
    claim: 'phaseModulate / rateMask / xorImprint',
    status: 'modeled',
    detail:
      'Invented here: reproducible, reversible, and carrying no efficacy claim of any kind. Not cryptography.',
    source: 'this package',
  },
]

export interface SourceLink {
  readonly label: string
  readonly href: string
  readonly note: string
}

export const SOURCE_LINKS: readonly SourceLink[] = [
  {
    label: 'radionics.co.uk — MGA-Rae information',
    href: 'http://www.radionics.co.uk/index.php/radionic-instruments/mga-rae-information',
    note: 'practitioner page — the card description and the base-44 quote',
  },
  {
    label: 'Wired Alchemy — The 10, the 44, and the 336',
    href: 'https://wiredalchemy.com/radionic-rates-the-10-the-44-and-the-336/',
    note: 'practitioner page — Combe’s rate books and the "336" convention',
  },
  {
    label: 'psychotronics.org — Radionics Basic Instrument Design 101, v6 (2024)',
    href: 'https://www.psychotronics.org/pub/lib/2024-02-16-radionics-basic-instrument-design-v6.pdf',
    note: 'design document — 360/44 ≈ 8.18° per base-44 step',
  },
  {
    label: 'Wikipedia — Radionics',
    href: 'https://en.wikipedia.org/wiki/Radionics',
    note: 'the efficacy record: nothing shown under controlled conditions',
  },
]
