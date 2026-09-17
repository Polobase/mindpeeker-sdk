# Architecture decision records

Cross-cutting decisions that apply to several packages, in the
[MADR](https://adr.github.io/madr/) format. Package-specific choices live in the package
READMEs. All eight records were accepted for the 0.2.0 release (2026-09-17); the linked
commits implement them.

| # | Decision | Status |
|---|---|---|
| [0001](0001-reader-lifecycle.md) | Whoever opens a reader or iterator closes it | accepted |
| [0002](0002-boundary-validation-and-error-codes.md) | Validate at the public boundary and throw the package's own error codes | accepted |
| [0003](0003-abort-contract.md) | Sources may throw or return on abort; consumers race the signal and report `aborted` | accepted |
| [0004](0004-vdf-signed-quadratic-residues.md) | The VDF works in the signed quadratic residues $QR_N^+$ | accepted |
| [0005](0005-seeded-permutations-in-psi.md) | Permutation nulls in psi use seeded permutations, not rotations | accepted |
| [0006](0006-versioned-registration-digests.md) | Registration digests hash a versioned, default-resolved RFC 8785 envelope | accepted |
| [0007](0007-canonical-gematria-alphabets.md) | Every gematria cipher has a canonical alphabet and a fold | accepted |
| [0008](0008-semver-policy-0x.md) | While 0.x, behaviour changes ship in a minor release and are listed | accepted |

Commit links point to <https://github.com/Polobase/mindpeeker-sdk>.

To add a record, copy the section layout of an existing one, take the next number, and link
the commits that implement it.
