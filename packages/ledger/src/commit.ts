import { LedgerError } from './errors.js'
import { bytesEqual, concatBytes, lengthPrefixed, requireBytes, toBytes } from './internal/bytes.js'
import { digest256 } from './internal/subtle.js'
import type { BytesInput } from './types.js'

/** Domain tag prepended (as UTF-8, unprefixed) to every commitment preimage. */
export const COMMIT_DOMAIN = 'mindpeeker-ledger-commit'
/** Domain tag of the beacon-mixing hash in {@link combineReveals}. */
export const COMBINE_DOMAIN = 'mindpeeker-ledger-combine'
/** Shortest nonce accepted; 32 bytes from `crypto.getRandomValues` is recommended. */
export const MIN_NONCE_BYTES = 16

const encoder = new TextEncoder()

function preimage(value: Uint8Array, nonce: Uint8Array): Uint8Array<ArrayBuffer> {
  return concatBytes(encoder.encode(COMMIT_DOMAIN), lengthPrefixed(value), lengthPrefixed(nonce))
}

/**
 * Hash commitment (the commit step of Blum's coin flipping):
 *
 * $$c = \mathrm{SHA\text{-}256}(\texttt{"mindpeeker-ledger-commit"} \,\|\, \mathrm{LP}(v) \,\|\, \mathrm{LP}(r)),
 * \quad \mathrm{LP}(x) = \mathrm{u64be}(|x|) \,\|\, x$$
 *
 * Binding rests on SHA-256 collision resistance; hiding on the nonce `r`
 * being secret and unpredictable (≥ 16 bytes enforced, 32 random bytes
 * recommended — `crypto.getRandomValues(new Uint8Array(32))`). The length
 * prefixes make `(v, r)` recoverable from the preimage, so no two different
 * openings share one encoding. Publish `c`; keep `v` and `r` until the reveal.
 *
 * @throws {LedgerError} `invalid_input` for a non-byte value/nonce or a nonce
 *   shorter than {@link MIN_NONCE_BYTES}.
 */
export async function commit(value: BytesInput, nonce: Uint8Array): Promise<Uint8Array> {
  const v = toBytes(value, 'value')
  const r = requireBytes(nonce, 'nonce')
  if (r.length < MIN_NONCE_BYTES) {
    throw new LedgerError('invalid_input', `nonce must be at least ${MIN_NONCE_BYTES} bytes`)
  }
  return digest256(preimage(v, r))
}

/**
 * Check a revealed `(value, nonce)` against a published commitment. Returns
 * false — never throws — for any mismatch, including a commitment that is
 * not 32 bytes or a nonce too short to have come from {@link commit}.
 *
 * @throws {LedgerError} `invalid_input` when an argument has the wrong type.
 */
export async function openCommitment(
  commitment: Uint8Array,
  value: BytesInput,
  nonce: Uint8Array,
): Promise<boolean> {
  const c = requireBytes(commitment, 'commitment')
  const v = toBytes(value, 'value')
  const r = requireBytes(nonce, 'nonce')
  if (c.length !== 32 || r.length < MIN_NONCE_BYTES) return false
  return bytesEqual(await digest256(preimage(v, r)), c)
}

/**
 * Combine the opened values of a commit–reveal round into one seed.
 *
 * Without a beacon: the XOR of all values (equal lengths). If at least one
 * party chose its value uniformly and independently — which the commitments
 * enforce, because nobody could see the others' values before committing —
 * the XOR is uniform, whatever the other parties did.
 *
 * With a beacon value (the public randomness of a round that was chosen
 * *before* the commitments and published *after* the reveals):
 * $\mathrm{SHA\text{-}256}(\texttt{"mindpeeker-ledger-combine"} \,\|\, \mathrm{LP}(\oplus v_i) \,\|\, \mathrm{LP}(b))$.
 *
 * **Caveat — last-revealer abort.** Commit–reveal is not fair against a party
 * who opens last: having seen every other reveal, it knows the outcome and
 * can refuse to open, forcing a restart (a bias of up to one bit per abort).
 * Treat a missing reveal as a protocol failure that is recorded and never
 * silently retried, and remove the advantage by binding the seed to a
 * *future* beacon round: when round R is fixed in the registration and
 * published only after the reveal deadline, no revealer can compute the
 * outcome in time, so aborting gains nothing. (A VDF seal over the reveals
 * gives the same property without a beacon.) The beacon term does not help
 * if the round is already public when the last party reveals.
 *
 * @throws {LedgerError} `invalid_input` for an empty list, values of unequal or
 *   zero length, or an empty beacon.
 */
export async function combineReveals(
  values: readonly Uint8Array[],
  beacon?: Uint8Array,
): Promise<Uint8Array> {
  if (!Array.isArray(values) || values.length === 0) {
    throw new LedgerError('invalid_input', 'values must be a non-empty array of Uint8Array')
  }
  const copies = values.map((value, i) => requireBytes(value, `values[${i}]`))
  const length = (copies[0] as Uint8Array).length
  if (length === 0 || copies.some((value) => value.length !== length)) {
    throw new LedgerError('invalid_input', 'values must all have the same non-zero length')
  }
  const xor = new Uint8Array(length)
  for (const value of copies) {
    for (let i = 0; i < length; i++) xor[i] = (xor[i] as number) ^ (value[i] as number)
  }
  if (beacon === undefined) return xor
  const b = requireBytes(beacon, 'beacon')
  if (b.length === 0) throw new LedgerError('invalid_input', 'beacon must not be empty')
  return digest256(
    concatBytes(encoder.encode(COMBINE_DOMAIN), lengthPrefixed(xor), lengthPrefixed(b)),
  )
}
