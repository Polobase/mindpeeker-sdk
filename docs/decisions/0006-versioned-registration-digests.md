# 0006: Registration digests hash a versioned, default-resolved RFC 8785 envelope

- Status: accepted
- Date: 2026-09-17
- Deciders: Manuel Haller Polo (maintainer)

## Context and problem statement

A pre-registration is only useful if its hash identifies one analysis, and one analysis has
one hash. In 0.1.0 `registerExperiment` in `@mindpeeker/negentropy` hashed the configuration as
the caller wrote it:

- defaults were not filled in, so a config that spelled out a default and one that omitted it
  described the same analysis but hashed differently;
- the digest carried no schema version, so a future change to what a field means could leave
  equal hashes describing different analyses;
- `canonicalJson` serialized `Map` and `Set` as `{}`, a `Date` as an ISO string (and threw a
  bare `RangeError` for an invalid one), and dropped `undefined` members, so distinct inputs
  could collide or change silently.

Other packages were about to hash records too: psi's tripolar schedules and sequential plans,
and the new `@mindpeeker/ledger` registration and time-bracket records.

## Decision drivers

- Equal analyses hash equally; different analyses never share a hash.
- The format must be specified well enough for an independent implementation to reproduce the
  hash.
- Changing the configuration schema later must not reinterpret old hashes.

## Considered options

1. Keep hashing the raw config and document the pitfalls.
2. Tag unsupported types (`{"$date": …}`) and keep hashing the raw config.
3. **Resolve every default, validate strictly, and hash a versioned envelope serialized with
   RFC 8785 (JSON Canonicalization Scheme), rejecting values JSON cannot represent exactly.**

## Decision outcome

Chosen option 3.

- `registerExperiment` validates the config (unknown keys, duplicate event ids and malformed
  windows are rejected), fills in every default, and hashes
  `{"schema":"negentropy/experiment/1","config":<resolved config>}`. It returns the schema, the
  frozen resolved config, the exact canonical string and the SHA-256 hash.
- `canonicalJson` follows RFC 8785 and throws `invalid_config` for `Date`, `Map`, `Set`,
  `BigInt`, `undefined` members, array holes, typed arrays, class instances, symbols, lone
  surrogates, noncharacters and cycles.
- A registration whose config was mutated after hashing is refused; optional beacon anchors are
  part of the hashed config.
- Any change to the meaning or set of fields gets a new schema identifier.
- The same rule is used elsewhere: psi hashes tripolar schedules and sequential plans
  (`psi/sequential/1`) as canonical JSON, and `@mindpeeker/ledger` hashes
  `{schema, registration}` with its own RFC 8785 implementation (schema
  `mindpeeker-ledger/registration/1`). A ledger test checks that ledger's `canonicalize` and
  negentropy's `canonicalJson` agree on fixed and seeded random values.

### Consequences

- Good: the canonical string can be reproduced outside the SDK; the RFC 8785 number vectors,
  its worked example and the envelope hashes were checked against a separate Python
  implementation.
- Good: re-analysis can be bound to the registration (`analyzeTrials` accepts
  `{ registration, calibration }`).
- Bad: every 0.1.x registration hash changes, and configs containing a `Date`, `Map` or `Set`
  now throw instead of hashing.
- Open: the envelope does not include the names of the data sources; adding them needs a new
  schema version.

## More information

- Implementation: negentropy [`719a865`](https://github.com/Polobase/mindpeeker-sdk/commit/719a86516d26605311c60febd6d7834777643b11);
  psi [`7728a2d`](https://github.com/Polobase/mindpeeker-sdk/commit/7728a2d27748b7c4a29612faff0a185e832e6096);
  ledger [`9e3cf15`](https://github.com/Polobase/mindpeeker-sdk/commit/9e3cf151d7dde8871b928f7b0f80288ad9be3568).
- [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785).
