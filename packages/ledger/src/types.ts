/** A JSON primitive. */
export type JsonPrimitive = null | boolean | number | string

/** A JSON value as `canonicalize` accepts it (plain objects and arrays only). */
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }

/** Bytes, or a string that is hashed as its UTF-8 encoding. */
export type BytesInput = Uint8Array | string

/**
 * The state needed to append to a ledger hash chain — nothing else: the
 * lines themselves are the caller's to persist.
 */
export interface ChainHead {
  /** `prev` of entry 0 (lower-case hex SHA-256). Default {@link ZERO_HASH}. */
  readonly genesis: string
  /** SHA-256 hex of the last line's UTF-8 bytes, or `genesis` for an empty chain. */
  readonly head: string
  /** Number of entries so far; the next entry's `i`. */
  readonly size: number
}

/**
 * One ledger chain line, serialized as the RFC 8785 canonical JSON of
 * `{ i, prev, record }` (members in that order, which is also sorted order).
 */
export interface ChainEntry {
  /** 0-based position in the chain. */
  readonly i: number
  /** Lower-case hex SHA-256 of the previous line's exact UTF-8 bytes (the genesis for `i = 0`). */
  readonly prev: string
  /** The payload, as recorded (deeply frozen). */
  readonly record: JsonValue
}

/** Whether a hypothesis is tested with error control or only explored. */
export type HypothesisKind = 'confirmatory' | 'exploratory'

/** Sidedness of a confirmatory test. */
export type TestDirection = 'two-sided' | 'greater' | 'less'

/** Multiplicity control across the confirmatory hypotheses. */
export type MultiplicityCorrection = 'none' | 'bonferroni' | 'holm' | 'benjamini-hochberg'

/** One pre-registered hypothesis (KPU registry: each tagged confirmatory or exploratory). */
export interface Hypothesis {
  /** Short identifier, unique within the registration (e.g. `H1`). */
  readonly id: string
  /** The hypothesis in words. */
  readonly statement: string
  readonly kind: HypothesisKind
  /** Test statistic. Required for confirmatory hypotheses. */
  readonly statistic?: string
  /** The statistic's distribution under the null, e.g. `N(0, 1)` or `Binomial(n, 1/4)`. Required for confirmatory. */
  readonly null?: string
  /** Sidedness. Required for confirmatory. */
  readonly direction?: TestDirection
}

/** A fixed sample size decided before data collection. */
export interface FixedSample {
  readonly kind: 'fixed'
  /** Planned number of units. Safe integer ≥ 1. */
  readonly size: number
  /** What is counted: `trials`, `sessions`, `participants`, `bits`, … */
  readonly unit: string
}

/** A sequential design: the stopping rule is part of the registration. */
export interface SequentialSample {
  readonly kind: 'sequential'
  /** The stopping rule in words (e.g. `stop when BF10 ≥ 10 or BF01 ≥ 10, checked every 100 trials`). */
  readonly rule: string
  /** Minimum units before the first look. Safe integer ≥ 1, ≤ `maxSize`. */
  readonly minSize?: number
  /** Hard cap on units. Safe integer ≥ 1. */
  readonly maxSize: number
  readonly unit: string
  /** Hex SHA-256 of a machine-readable plan (e.g. psi `sequentialPlanDigest`). */
  readonly planHash?: string
}

/** How the sample size is fixed. */
export type SamplePlan = FixedSample | SequentialSample

/** Where the data comes from. */
export interface DataSource {
  /** Identifier, unique within the registration (e.g. a provider or device name). */
  readonly name: string
  readonly description?: string
  /** Experimental source or matched control (e.g. a CSPRNG control arm). */
  readonly role?: 'experimental' | 'control'
}

/**
 * A pre-registration record modelled on the Koestler Parapsychology Unit
 * registry: hypotheses tagged confirmatory/exploratory, each confirmatory one
 * with its statistic, null and direction; the primary hypothesis and alpha;
 * sample size or stopping rule; a digest of the analysis plan/code; exclusion
 * rules; and data sources. Hash it with `registrationHash`.
 */
export interface Registration {
  readonly title: string
  readonly authors?: readonly string[]
  /** At least one; ids unique; at least one confirmatory. */
  readonly hypotheses: readonly Hypothesis[]
  /** Id of the primary confirmatory hypothesis. */
  readonly primary: string
  /** Type-I error rate for the confirmatory tests, 0 < alpha < 1. */
  readonly alpha: number
  /** Required when more than one hypothesis is confirmatory. */
  readonly correction?: MultiplicityCorrection
  readonly sample: SamplePlan
  /** Lower-case hex SHA-256 of the analysis plan document or code. */
  readonly analysisPlanHash: string
  /** Exclusion rules, fixed in advance. An empty array states "no exclusions". */
  readonly exclusions: readonly string[]
  /** At least one; names unique. */
  readonly dataSources: readonly DataSource[]
  /** Blinding procedure, if any. */
  readonly blinding?: string
  /** Hash of the registration this one revises (revisions are published alongside originals). */
  readonly supersedes?: string
  readonly notes?: string
}

/** A public beacon round embedded in a record: proves "created no earlier than". */
export interface BeaconAnchor {
  /** Beacon family, e.g. `drand`, `nist`, `curby`. */
  readonly source: string
  /** Chain identifier as a string: a drand chain hash, a NIST chain index, a CURBy chain CID. */
  readonly chain: string
  /** Round number within the chain (entropy `BeaconRound.round`). Safe integer ≥ 0. */
  readonly round: number
  /** Publication time, ISO 8601 UTC (`YYYY-MM-DDTHH:MM:SS[.sss]Z`). */
  readonly timestamp: string
  /** The round's public value as lower-case hex (e.g. drand `randomness`, NIST `outputValue`). */
  readonly valueHex: string
}

/** A VDF seal over the bracket's seal input (`timeBracketSealInput`). */
export interface VdfSealAnchor {
  readonly kind: 'vdf-pietrzak'
  /** Lower-case hex of the `@mindpeeker/vdf` `sealToBytes` wire format. */
  readonly bytesHex: string
}

/** Kind of external witness for the "no later than" bound. */
export type NotAfterKind = 'ots' | 'rekor' | 'tlog-checkpoint' | 'beacon'

/** A reference to an external witness that saw the registration hash by some time. */
export interface NotAfterAnchor {
  readonly kind: NotAfterKind
  /** Opaque reference: an .ots proof (base64), a Rekor entry UUID, a checkpoint text, a later beacon round. */
  readonly ref: string
}

/** Evidence bounding when a registration was fixed. */
export interface TimeBracket {
  /** Lower-case hex SHA-256 of the registration (ledger, negentropy or psi digest). */
  readonly registrationHash: string
  readonly notBefore: { readonly beacon: BeaconAnchor }
  readonly seal?: VdfSealAnchor
  readonly notAfter?: NotAfterAnchor
}

/** One signature line of a signed note: `— <name> base64(keyId ‖ signature)`. */
export interface NoteSignature {
  /** Key name (non-empty, no spaces, no `+`). */
  readonly name: string
  /** Big-endian uint32 key ID. */
  readonly keyId: number
  /** Signature bytes after the key ID. */
  readonly signature: Uint8Array
}

/** A C2SP signed note: the signed text (ending in a newline) and its signatures. */
export interface SignedNote {
  readonly text: string
  readonly signatures: readonly NoteSignature[]
}

/** A parsed verifier key `<name>+<hex keyId>+base64(type ‖ publicKey)`. */
export interface VerifierKey {
  readonly name: string
  readonly keyId: number
  /** Signature type byte: `0x01` Ed25519 (the only type verified here). */
  readonly type: number
  readonly publicKey: Uint8Array
}

/** The note text of a C2SP tlog checkpoint. */
export interface Checkpoint {
  /** Log identity (first line), non-empty. */
  readonly origin: string
  /** Number of leaves. Safe integer ≥ 0. */
  readonly size: number
  /** RFC 6962 Merkle tree hash at `size` (32 bytes). */
  readonly root: Uint8Array
  /** Opaque, non-empty extension lines (NOT RECOMMENDED by the spec). */
  readonly extensions: readonly string[]
}
