// The KPU-style pre-registration form: a form-shaped draft, the record it
// becomes, and the deliberate faults the page uses to show what
// validateRegistration refuses.
//
// CLIENT-ONLY — imports @mindpeeker/ledger.

import { type Registration, sha256Hex } from '@mindpeeker/ledger'

export interface HypothesisDraft {
  id: string
  statement: string
  kind: 'confirmatory' | 'exploratory'
  statistic: string
  nullDist: string
  direction: 'two-sided' | 'greater' | 'less'
}

export interface SourceDraft {
  name: string
  description: string
  role: '' | 'experimental' | 'control'
}

export interface RegistrationDraft {
  title: string
  authors: string
  hypotheses: HypothesisDraft[]
  primary: string
  alpha: number
  correction: '' | 'none' | 'bonferroni' | 'holm' | 'benjamini-hochberg'
  sampleKind: 'fixed' | 'sequential'
  size: number
  unit: string
  rule: string
  minSize: number
  maxSize: number
  /** Hashed into `analysisPlanHash`, so the field is never typed by hand. */
  analysisPlan: string
  exclusions: string
  dataSources: SourceDraft[]
  blinding: string
  notes: string
}

export function defaultDraft(): RegistrationDraft {
  return {
    title: 'Tripolar REG replication with a yoked control arm',
    authors: 'A. Researcher, B. Statistician',
    hypotheses: [
      {
        id: 'H1',
        statement: 'high-intention runs exceed low-intention runs',
        kind: 'confirmatory',
        statistic: 'deltaZ = (zHI - zLO) / sqrt(2)',
        nullDist: 'N(0, 1)',
        direction: 'greater',
      },
      {
        id: 'E1',
        statement: 'the control arm shows no separation',
        kind: 'exploratory',
        statistic: '',
        nullDist: '',
        direction: 'two-sided',
      },
    ],
    primary: 'H1',
    alpha: 0.05,
    correction: '',
    sampleKind: 'fixed',
    size: 3000,
    unit: 'trials per arm',
    rule: 'stop when BF10 >= 10 or BF01 >= 10, checked every 100 trials',
    minSize: 500,
    maxSize: 20000,
    analysisPlan:
      'analysis.ts @ commit 5f3a91c: analyzeTripolar(runs, { registration }), one-sided deltaP, no exclusions beyond source-health aborts',
    exclusions: 'runs aborted by a source health failure',
    dataSources: [
      { name: 'truerng-3', description: 'the experimental device', role: 'experimental' },
      { name: 'hmac-drbg(control)', description: 'a yoked algorithmic control arm', role: 'control' },
    ],
    blinding: 'the schedule seed stays with the experimenter until the session ends',
    notes: '',
  }
}

const trimmed = (value: string): string[] =>
  value
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '')

/** The record the form describes, ready for `validateRegistration`. */
export async function toRegistration(draft: RegistrationDraft): Promise<Registration> {
  const authors = trimmed(draft.authors)
  const record = {
    title: draft.title,
    ...(authors.length > 0 ? { authors } : {}),
    hypotheses: draft.hypotheses.map((h) => ({
      id: h.id,
      statement: h.statement,
      kind: h.kind,
      ...(h.kind === 'confirmatory' || h.statistic !== '' ? { statistic: h.statistic } : {}),
      ...(h.kind === 'confirmatory' || h.nullDist !== '' ? { null: h.nullDist } : {}),
      ...(h.kind === 'confirmatory' ? { direction: h.direction } : {}),
    })),
    primary: draft.primary,
    alpha: draft.alpha,
    ...(draft.correction !== '' ? { correction: draft.correction } : {}),
    sample:
      draft.sampleKind === 'fixed'
        ? { kind: 'fixed' as const, size: draft.size, unit: draft.unit }
        : {
            kind: 'sequential' as const,
            rule: draft.rule,
            minSize: draft.minSize,
            maxSize: draft.maxSize,
            unit: draft.unit,
          },
    analysisPlanHash: await sha256Hex(draft.analysisPlan),
    exclusions: trimmed(draft.exclusions),
    dataSources: draft.dataSources.map((s) => ({
      name: s.name,
      ...(s.description !== '' ? { description: s.description } : {}),
      ...(s.role !== '' ? { role: s.role } : {}),
    })),
    ...(draft.blinding !== '' ? { blinding: draft.blinding } : {}),
    ...(draft.notes !== '' ? { notes: draft.notes } : {}),
  }
  return record as unknown as Registration
}

/** A deliberate fault applied to the record after the form built it. */
export interface RegistrationFault {
  readonly value: string
  readonly label: string
  /** The message `validateRegistration` is expected to throw. */
  readonly expect: string
  readonly apply: (record: Record<string, unknown>) => Record<string, unknown>
}

export const FAULTS: readonly RegistrationFault[] = [
  { value: 'none', label: 'none — the form as filled in', expect: 'validates', apply: (r) => r },
  {
    value: 'two-confirmatory',
    label: 'make the second hypothesis confirmatory too',
    expect: '$.correction is required with more than one confirmatory hypothesis',
    apply: (r) => ({
      ...r,
      hypotheses: (r.hypotheses as Record<string, unknown>[]).map((h, i) =>
        i === 1
          ? { ...h, kind: 'confirmatory', statistic: 'control deltaZ', null: 'N(0, 1)', direction: 'two-sided' }
          : h,
      ),
      correction: undefined,
    }),
  },
  {
    value: 'primary-exploratory',
    label: 'point primary at the exploratory hypothesis',
    expect: '$.primary must be the id of a confirmatory hypothesis',
    apply: (r) => ({ ...r, primary: 'E1' }),
  },
  {
    value: 'alpha-zero',
    label: 'set alpha to 0',
    expect: '$.alpha must be a number in (0, 1)',
    apply: (r) => ({ ...r, alpha: 0 }),
  },
  {
    value: 'missing-direction',
    label: 'drop the confirmatory hypothesis’s direction',
    expect: '$.hypotheses[0].direction must be one of two-sided | greater | less',
    apply: (r) => ({
      ...r,
      hypotheses: (r.hypotheses as Record<string, unknown>[]).map((h, i) =>
        i === 0 ? { ...h, direction: undefined } : h,
      ),
    }),
  },
  {
    value: 'unknown-field',
    label: 'add a misspelled field (hypothesis, not hypotheses)',
    expect: '$.hypothesis is not a registration field',
    apply: (r) => ({ ...r, hypothesis: 'a typo that would vanish from the hash unnoticed' }),
  },
  {
    value: 'duplicate-source',
    label: 'name both data sources the same',
    expect: '$.dataSources has a duplicate name "truerng-3"',
    apply: (r) => ({
      ...r,
      dataSources: (r.dataSources as Record<string, unknown>[]).map((d) => ({ ...d, name: 'truerng-3' })),
    }),
  },
  {
    value: 'bad-plan-hash',
    label: 'write the analysis-plan hash in upper case',
    expect: '$.analysisPlanHash must be a lower-case hex SHA-256 (64 digits)',
    apply: (r) => ({ ...r, analysisPlanHash: String(r.analysisPlanHash).toUpperCase() }),
  },
  {
    value: 'lone-surrogate',
    label: 'put a lone surrogate in the title',
    expect:
      'the schema passes, canonicalize refuses: $.registration.title is a string with a lone surrogate',
    apply: (r) => ({ ...r, title: `${String(r.title)} ${String.fromCharCode(0xd800)}` }),
  },
]

/** Drop members whose value is `undefined` so the record stays canonical JSON. */
export function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))
}
