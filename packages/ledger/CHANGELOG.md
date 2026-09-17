# @mindpeeker/ledger

## 0.2.0

### Minor Changes

- New package, first release on npm. Tamper-evident experiment records built from standard cryptography, with no dependencies beyond WebCrypto: RFC 8785 canonical JSON, hash-chained JSONL (which also verifies psi schema-v2 recordings byte for byte), RFC 6962 Merkle trees with inclusion and consistency proofs, C2SP signed-note checkpoints with Ed25519, Blum commit–reveal, a pre-registration schema, and beacon/VDF time-bracket records. A ledger proves what was written and, with published anchors, roughly when; it never proves that a hypothesis is true or that the data came from where it claims.
