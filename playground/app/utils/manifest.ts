// The package catalog that drives the header navigation, the landing grid and
// every package page header. SSR-safe: plain data, no @mindpeeker imports.
//
// Every number here is derived from the 0.2.0 code and docs:
//   30 entropy backends · 43 gematria ciphers across 10 scripts ·
//   191 lexicon entries · 10 oracle systems.

export const SDK_VERSION = '0.2.0'
export const REPO_URL = 'https://github.com/Polobase/mindpeeker-sdk'
export const REPO_TREE_URL = `${REPO_URL}/tree/main`
export const REPO_BLOB_URL = `${REPO_URL}/blob/main`
export const RESEARCH_URL = `${REPO_BLOB_URL}/docs/research.md`
export const COOKBOOK_URL = `${REPO_BLOB_URL}/docs/cookbook.md`
export const RELEASES_URL = `${REPO_BLOB_URL}/RELEASES.md`
export const CONTRIBUTING_URL = `${REPO_BLOB_URL}/CONTRIBUTING.md`
export const LICENSE_URL = `${REPO_BLOB_URL}/LICENSE`
export const DECISIONS_URL = `${REPO_TREE_URL}/docs/decisions`

export type GroupId = 'randomness' | 'experiments' | 'symbolic' | 'integrity' | 'tools'

export interface GroupEntry {
  /** Stable id, also the anchor on the landing page. */
  readonly id: GroupId
  /** Full label, used on the landing page and in the mobile menu. */
  readonly label: string
  /** Short label for the desktop navigation trigger. */
  readonly short: string
  /** One line describing what the group is for. */
  readonly description: string
  readonly icon: string
}

export const GROUPS: readonly GroupEntry[] = [
  {
    id: 'randomness',
    label: 'Randomness & order',
    short: 'Randomness',
    description: 'Where the bytes come from, whether they hold order, and how order moves.',
    icon: 'i-lucide-dices',
  },
  {
    id: 'experiments',
    label: 'Experiments & scoring',
    short: 'Experiments',
    description: 'Protocols, exact scoring, coincidence prices and time-of-day covariates.',
    icon: 'i-lucide-flask-conical',
  },
  {
    id: 'symbolic',
    label: 'Symbolic & spatial',
    short: 'Symbolic',
    description: 'Exact mappings from bytes and letters to symbols, rates, catalogs and space.',
    icon: 'i-lucide-shapes',
  },
  {
    id: 'integrity',
    label: 'Integrity & time',
    short: 'Integrity',
    description: 'What was written, in what order, and no earlier than when.',
    icon: 'i-lucide-shield-check',
  },
  {
    id: 'tools',
    label: 'Tools',
    short: 'Tools',
    description: 'Watching many windows at once — without claiming any of them.',
    icon: 'i-lucide-layout-dashboard',
  },
]

export interface PackageEntry {
  /** Page slug: /<id> and app/pages/<id>.vue. */
  readonly id: string
  readonly pkg: string
  readonly title: string
  /** One accurate sentence about the package at 0.2.0. */
  readonly tagline: string
  /** Lucide icon, written as a complete literal so the icon scanner sees it. */
  readonly icon: string
  readonly group: GroupId
  /** New in 0.2.0. */
  readonly isNew?: boolean
  /** 2–4 short bullets from RELEASES.md / the package README. */
  readonly highlights: readonly string[]
  /** GitHub tree URL of the package directory (its README renders there). */
  readonly readmeUrl: string
  /** docs/research.md section for this package. */
  readonly researchAnchor: string
  /** Label of that research section, e.g. "§ 1". */
  readonly researchLabel: string
  /** docs/cookbook.md recipes where this package plays a central role. */
  readonly cookbookRecipes: readonly number[]
}

const readme = (id: string) => `${REPO_TREE_URL}/packages/${id}`

export const PACKAGES: readonly PackageEntry[] = [
  {
    id: 'entropy',
    pkg: '@mindpeeker/entropy',
    title: 'Entropy',
    tagline:
      '30 entropy backends — QRNGs, public beacons, local sensors and a seeded HMAC_DRBG — behind one interface, with SP 800-90B health tests and honest source attribution.',
    icon: 'i-lucide-dices',
    group: 'randomness',
    highlights: [
      'drbgProvider: SP 800-90A HMAC_DRBG for seeded control runs and byte-exact replay',
      'SP 800-90B restart semantics — the third health alarm of a session fails, not the first',
      'Adaptive Proportion Test cutoffs computed exactly in log space',
      'Beacon round metadata, getRound, and opt-in structural verification',
    ],
    readmeUrl: readme('entropy'),
    researchAnchor: '1-entropy-sources-and-conditioning--mindpeekerentropy',
    researchLabel: '§ 1 Entropy sources and conditioning',
    cookbookRecipes: [10, 12, 1],
  },
  {
    id: 'negentropy',
    pkg: '@mindpeeker/negentropy',
    title: 'Negentropy',
    tagline:
      'Order detection in noise: GCP-style network statistics, entropy estimators, anytime-valid monitoring and SP 800-90B extraction.',
    icon: 'i-lucide-activity',
    group: 'randomness',
    highlights: [
      'Anytime-valid monitoring: netvarMartingale, driftMartingale, anytimeP, villeCrossing',
      'χ² p-values exact at GCP scale (Temme expansion) and correct lower-tail quantiles',
      "Overlapping events combined with Brown's correction (null variance ≈ 1)",
      'Versioned registration digests; stop() never throws, it marks events incomplete',
    ],
    readmeUrl: readme('negentropy'),
    researchAnchor: '2-negentropy-and-order-detection--mindpeekernegentropy',
    researchLabel: '§ 2 Negentropy and order detection',
    cookbookRecipes: [1, 12, 3, 9],
  },
  {
    id: 'flow',
    pkg: '@mindpeeker/flow',
    title: 'Flow',
    tagline:
      'Transfer entropy and information dynamics for discrete symbol streams, with χ² and surrogate significance tests.',
    icon: 'i-lucide-waypoints',
    group: 'randomness',
    highlights: [
      'χ² test for transfer entropy with an adequacy guard',
      'Conditional and collective transfer entropy, plus active information storage',
      'Lag scans and new surrogate families (seeded xoshiro128**)',
    ],
    readmeUrl: readme('flow'),
    researchAnchor: '3-directed-information-flow--mindpeekerflow',
    researchLabel: '§ 3 Directed information flow',
    cookbookRecipes: [3],
  },
  {
    id: 'psi',
    pkg: '@mindpeeker/psi',
    title: 'Psi',
    tagline:
      'Mind–matter experiment protocols: tripolar runs with a yoked control arm, GCP event analysis, Bayes factors and anytime-valid e-processes.',
    icon: 'i-lucide-brain',
    group: 'experiments',
    highlights: [
      'Tripolar schedules with a yoked control arm, controlContrast and TOST equivalence',
      'coinEProcess survives continuous peeking: 0.037 vs 0.511 for a re-checked fixed-n p',
      'Presentiment label-shuffle null uses seeded permutations (H0 calibration tested)',
      'Hash-chained JSONL v2 recordings with verifyChain, and GCP basket-file parsing',
    ],
    readmeUrl: readme('psi'),
    researchAnchor: '4-mindmatter-interaction-statistics--mindpeekerpsi',
    researchLabel: '§ 4 Mind–matter interaction statistics',
    cookbookRecipes: [2, 3, 11],
  },
  {
    id: 'judging',
    pkg: '@mindpeeker/judging',
    title: 'Judging',
    tagline:
      'Exact scoring for forced-choice and free-response designs: binomial tails, closed-deck matching, rank-matrix permutation tests and displacement variance.',
    icon: 'i-lucide-scale',
    group: 'experiments',
    isNew: true,
    highlights: [
      'Exact binomial tails, Clopper–Pearson intervals and Rosenthal–Rubin π',
      'Closed decks are not independent draws, and feedback moves chance (8.65 hits per 25)',
      'SRI rank-matrix permutation tests, optional-stopping risk and multiplicity baselines',
    ],
    readmeUrl: readme('judging'),
    researchAnchor: '11-scoring-the-human-side-of-experiments--mindpeekerjudging',
    researchLabel: '§ 11 Scoring the human side of experiments',
    cookbookRecipes: [8],
  },
  {
    id: 'coincidence',
    pkg: '@mindpeeker/coincidence',
    title: 'Coincidence',
    tagline:
      'Exact coincidence probabilities — the honest denominator: birthday generalisations, k-fold and near matches, and an exact clustering test.',
    icon: 'i-lucide-sparkles',
    group: 'experiments',
    isNew: true,
    highlights: [
      'Birthday generalisations: non-uniform categories, k-fold (Levin) and near matches',
      'Exact under explicit null models — they price a coincidence, they do not interpret it',
      'Diaconis–Mosteller approximations shown next to the exact numbers',
      "Fisher's 1924 graded-match scores and an exact event-clustering test",
    ],
    readmeUrl: readme('coincidence'),
    researchAnchor:
      '10-gematria-isopsephy-and-numerical-coincidence--mindpeekergematria-and-mindpeekercoincidence',
    researchLabel: '§ 10 Gematria, isopsephy and numerical coincidence',
    cookbookRecipes: [6],
  },
  {
    id: 'ephemeris',
    pkg: '@mindpeeker/ephemeris',
    title: 'Ephemeris',
    tagline:
      "Julian day, ΔT, sidereal time, the Sun and Moon (Meeus), and Spottiswoode's local-sidereal-time scan with a permutation null.",
    icon: 'i-lucide-orbit',
    group: 'experiments',
    isNew: true,
    highlights: [
      'Julian day, ΔT and GMST/GAST/LST checked against Meeus worked examples',
      'Sun and Moon positions, illumination and phase instants (Meeus ch. 25, 47–49)',
      'An LST window scan whose permutation null counts the peak search — and its seasonal confound',
    ],
    readmeUrl: readme('ephemeris'),
    researchAnchor: '12-time-sky-and-environmental-correlates--mindpeekerephemeris',
    researchLabel: '§ 12 Time, sky and environmental correlates',
    cookbookRecipes: [9],
  },
  {
    id: 'oracle',
    pkg: '@mindpeeker/oracle',
    title: 'Oracle',
    tagline:
      '10 divination systems — I-Ching, Tarot, runes, geomancy, Ifá, cowries, fortune sticks, Mo, astragaloi, the Homer oracle — with exact rational probabilities and a receipt for every bit.',
    icon: 'i-lucide-scroll-text',
    group: 'symbolic',
    highlights: [
      'Six new systems: Ifá, sixteen cowries, kau cim, Mo, astragaloi and the Homer oracle',
      'Reader lifecycle: a cast closes the reader it opened, so devices and sockets are released',
      'recordingReader captures the consumed bytes for byte-exact replay',
    ],
    readmeUrl: readme('oracle'),
    researchAnchor: '6-archetypal-mapping--mindpeekeroracle',
    researchLabel: '§ 6 Archetypal mapping',
    cookbookRecipes: [4, 5, 6, 8, 9],
  },
  {
    id: 'gematria',
    pkg: '@mindpeeker/gematria',
    title: 'Gematria',
    tagline:
      '43 exact-integer ciphers across 10 scripts, temurah and tziruph tables, a 191-entry public-domain lexicon and honest collision statistics.',
    icon: 'i-lucide-hash',
    group: 'symbolic',
    highlights: [
      'First npm release: 43 ciphers, reverse as a parameter rather than a separate cipher',
      'Canonical alphabets: Hebrew finals kept, the 27 Greek numerals, corrected Achbi',
      'NFKD folding for Arabic (موسى is 116) and script-aware lexicons',
    ],
    readmeUrl: readme('gematria'),
    researchAnchor:
      '10-gematria-isopsephy-and-numerical-coincidence--mindpeekergematria-and-mindpeekercoincidence',
    researchLabel: '§ 10 Gematria, isopsephy and numerical coincidence',
    cookbookRecipes: [6],
  },
  {
    id: 'rate',
    pkg: '@mindpeeker/rate',
    title: 'Rate',
    tagline:
      "Malcolm Rae's base-44 radionic encoding made exact: rate parsing, digit→angle geometry, circular statistics and SVG card rendering.",
    icon: 'i-lucide-radar',
    group: 'symbolic',
    highlights: [
      'No API change in 0.2.0 — only the supported Node range moved',
      'Parse a rate, read each digit’s phase angle, render its Magneto-Geometric card',
      'Deterministic stream modulation (xorImprint, phaseModulate, rateMask)',
    ],
    readmeUrl: readme('rate'),
    researchAnchor: '5-radionics-and-malcolm-raes-base-44--mindpeekerrate',
    researchLabel: "§ 5 Radionics and Malcolm Rae's base-44",
    cookbookRecipes: [],
  },
  {
    id: 'scan',
    pkg: '@mindpeeker/scan',
    title: 'Scan',
    tagline:
      'AetherOne-style radionic scanning with the one thing it never had: an exact per-item chance-deviation null, with multiplicity control.',
    icon: 'i-lucide-scan-search',
    group: 'symbolic',
    highlights: [
      'First npm release',
      'Exact two-sided binomial deviation p — the old normal tail crossed 0.05 at 7.7% under H0',
      'Ranking on the log Bayes factor, with Bonferroni, Holm and Benjamini–Hochberg fields',
      'Eight coins per byte and the AetherOnePi race subset rule',
    ],
    readmeUrl: readme('scan'),
    researchAnchor: '9-radionic-scanning-aetherone-and-the-deviation-null--mindpeekerscan',
    researchLabel: '§ 9 Radionic scanning, AetherOne and the deviation null',
    cookbookRecipes: [7],
  },
  {
    id: 'field',
    pkg: '@mindpeeker/field',
    title: 'Field',
    tagline:
      "Point fields tested against complete spatial randomness: attractors and voids with calibrated whole-field p-values, Ripley's K and Clark–Evans.",
    icon: 'i-lucide-map-pin',
    group: 'symbolic',
    highlights: [
      'First npm release',
      'An exact edge-corrected single-point tail plus a calibrated whole-field Monte-Carlo p',
      'The old void p was ≤ 0.05 on 88.5–100% of random fields; the attractor p now sits near 5%',
      'csrEnvelope with a global envelope test and a MAD test over all radii',
    ],
    readmeUrl: readme('field'),
    researchAnchor: '8-spatial-point-patterns-and-the-randonautica-lineage--mindpeekerfield',
    researchLabel: '§ 8 Spatial point patterns and the Randonautica lineage',
    cookbookRecipes: [5],
  },
  {
    id: 'vdf',
    pkg: '@mindpeeker/vdf',
    title: 'VDF',
    tagline:
      'Verifiable delay functions over RSA-2048 in the signed quadratic residues — Pietrzak and Wesolowski proofs, checkpoints and beacon seals.',
    icon: 'i-lucide-hourglass',
    group: 'integrity',
    highlights: [
      'Security fix: 0.1.0 accepted the negated output n − y; 0.2.0 computes in QR_N+',
      'Every output, proof and seal stored under 0.1.0 must be recomputed',
      'Wesolowski proofs: one group element, 526 bytes at 2048 bits',
      'Proof bytes carry a version and a modulus fingerprint; transcripts bind the modulus',
    ],
    readmeUrl: readme('vdf'),
    researchAnchor: '7-verifiable-delay-and-time-bounds--mindpeekervdf',
    researchLabel: '§ 7 Verifiable delay and time bounds',
    cookbookRecipes: [2],
  },
  {
    id: 'ledger',
    pkg: '@mindpeeker/ledger',
    title: 'Ledger',
    tagline:
      'Tamper-evident records from standard cryptography: RFC 8785 canonical JSON, hash chains, RFC 6962 Merkle proofs, signed notes and commit–reveal.',
    icon: 'i-lucide-link',
    group: 'integrity',
    isNew: true,
    highlights: [
      'Canonical JSON (RFC 8785) and hash-chained JSONL that also verifies psi v2 recordings',
      'Merkle inclusion and consistency proofs, C2SP signed notes (Ed25519)',
      'Proves what was written and roughly when — never that a hypothesis is true',
    ],
    readmeUrl: readme('ledger'),
    researchAnchor:
      '13-integrity-registrations-hash-chains-and-time-brackets--mindpeekerledger-psi-recordings-mindpeekervdf',
    researchLabel: '§ 13 Integrity: registrations, hash chains and time brackets',
    cookbookRecipes: [11, 2],
  },
  {
    id: 'visualizer',
    pkg: '@mindpeeker/visualizer',
    title: 'Visualizer',
    tagline:
      'WebGL2 dashboard panels for live bytes, statistic series with pointwise and anytime-valid bands, matrices and rate cards.',
    icon: 'i-lucide-chart-line',
    group: 'tools',
    highlights: [
      'A pointwise χ² band drawn next to a time-uniform, anytime-valid boundary',
      'Origin checks (allowedOrigins) and wire protocol 2 with per-kind layout versions',
      '--record / --replay of hash-chained psi JSONL v2 trials',
    ],
    readmeUrl: readme('visualizer'),
    researchAnchor: '14-the-bridge-how-the-stack-composes-and-what-would-count-as-evidence',
    researchLabel: '§ 14 The bridge: how the stack composes',
    cookbookRecipes: [],
  },
]

export interface CookbookRecipe {
  readonly n: number
  readonly title: string
  readonly anchor: string
}

export const COOKBOOK_RECIPES: readonly CookbookRecipe[] = [
  { n: 1, title: 'Live monitor with an anytime-valid boundary', anchor: '1-live-monitor-with-an-anytime-valid-boundary' },
  { n: 2, title: 'Pre-registered tripolar run with a control arm', anchor: '2-pre-registered-tripolar-run-with-a-control-arm' },
  { n: 3, title: 'Transfer-entropy independence check', anchor: '3-transfer-entropy-independence-check' },
  { n: 4, title: 'Oracle casts with exact accounting and replay', anchor: '4-oracle-casts-with-exact-accounting-and-replay' },
  { n: 5, title: 'Is my field special?', anchor: '5-is-my-field-special' },
  { n: 6, title: 'Pricing a gematria coincidence', anchor: '6-pricing-a-gematria-coincidence' },
  { n: 7, title: 'Radionic scan with an honest null', anchor: '7-radionic-scan-with-an-honest-null' },
  { n: 8, title: 'Scoring forced-choice studies', anchor: '8-scoring-forced-choice-studies' },
  { n: 9, title: 'Local sidereal time scan', anchor: '9-local-sidereal-time-scan' },
  { n: 10, title: 'Beacon rounds and structural checks', anchor: '10-beacon-rounds-and-structural-checks' },
  { n: 11, title: 'Tamper-evident log with Merkle proofs', anchor: '11-tamper-evident-log-with-merkle-proofs' },
  { n: 12, title: 'Custom provider with health tests', anchor: '12-custom-provider-with-health-tests' },
]

/** The package entry for a page id (undefined for an unknown id). */
export function packageById(id: string): PackageEntry | undefined {
  return PACKAGES.find((p) => p.id === id)
}

/** The packages of one group, in catalog order. */
export function packagesInGroup(group: GroupId): readonly PackageEntry[] {
  return PACKAGES.filter((p) => p.group === group)
}

export function groupById(id: GroupId): GroupEntry {
  return GROUPS.find((g) => g.id === id) as GroupEntry
}

/** Deep link into docs/research.md on GitHub. */
export function researchUrl(entry: PackageEntry): string {
  return `${RESEARCH_URL}#${entry.researchAnchor}`
}

/** Deep link into docs/cookbook.md on GitHub. */
export function cookbookUrl(n: number): string {
  const recipe = COOKBOOK_RECIPES.find((r) => r.n === n)
  return recipe ? `${COOKBOOK_URL}#${recipe.anchor}` : COOKBOOK_URL
}

export function cookbookRecipe(n: number): CookbookRecipe | undefined {
  return COOKBOOK_RECIPES.find((r) => r.n === n)
}
