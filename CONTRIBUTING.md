# Contributing to mindpeeker-sdk

Thanks for helping. This file covers the development setup, the rules every package follows,
how reference fixtures are made, and how changes reach a release. Package READMEs document
each API; [`docs/decisions/`](docs/decisions/) records why the cross-cutting rules exist.

## Development setup

The workspace pins **Bun 1.3.1** (`packageManager` in `package.json`; CI uses the same
version). Python is only needed to regenerate fixtures (see below).

```sh
bun install       # workspace dependencies
bun run build     # every package, in dependency order (scripts/build.ts)
bun run check     # biome, typecheck, README import checker, README table check
bun test          # all tests
```

Build before the first `bun run check`: the typecheck also runs each package's build
configuration, which resolves sibling packages through their built `dist` types, exactly as
consumers see them. Tests resolve siblings from `src` through the `paths` in
`tsconfig.base.json`, so a stale `dist` cannot hide a regression. `scripts/build.ts` deletes a
package's `dist` before building it, so deleted sources never leave stale files to publish.

Useful narrower loops:

```sh
bun test packages/psi                   # one package
(cd packages/psi && bun run typecheck)  # one package's typecheck
bunx biome check --write packages/psi   # format and lint one package
bun run readme:table                    # regenerate the root README table and graph
```

CI (`.github/workflows/ci.yml`) runs install with a frozen lockfile, build, check, test, and
`publint` plus `arethetypeswrong` on every package. The Pages deploys run CI first.

### Layout

| Path | Contents |
|---|---|
| `packages/<name>/src` | the published source (ESM, TypeScript) |
| `packages/<name>/test` | `bun:test` suites and checked-in fixtures |
| `packages/<name>/scripts/fixtures` | generators for the reference values in `test/fixtures` |
| `packages/<name>/README.md` | the package's API reference and its "Behaviour changes" section |
| `docs/` | research background, cookbook, devices, data sources and licences, decisions, releasing |
| `examples/` | private workspace with runnable versions of the cookbook recipes |
| `site/`, `playground/` | demo sites (never published) |
| `scripts/` | build, README checkers and generators |

## Repository conventions

**No third-party runtime dependencies.** A package may depend on another `@mindpeeker/*`
workspace package, never on outside code. If you need a numeric routine, look in
`@mindpeeker/negentropy/numerics` first. Development tools (Biome, TypeScript, publint, attw)
are fine.

**One typed error class per package.** Throw the package's own error (`FlowError`,
`LedgerError`, …) with `name`, a `code` from the exported code union and the underlying failure
as `cause`. Validate options at the public boundary, before any entropy or I/O is spent, and map
foreign errors (`RangeError`, `TypeError`, `DOMException`, a sibling package's error) to your
package's codes. Adding a code widens the union, which is a behaviour change: list it. See
[decision 0002](docs/decisions/0002-boundary-validation-and-error-codes.md).

**Streams and abort.** Follow the shared conventions in the root README: race pending pulls
against the `AbortSignal`, report a clean end after an abort as `aborted`, and close every
iterator or reader you open in a `finally`; leave a caller's reader open. See decisions
[0001](docs/decisions/0001-reader-lifecycle.md) and
[0003](docs/decisions/0003-abort-contract.md).

**Files stay under 500 lines.** Split modules by responsibility before they grow past that.

**Determinism.** The same inputs, seed and options give the same outputs on every run and
runtime. Randomized procedures (surrogates, permutations, dithering) take a `seed`; the
seeded generators are internal, documented and pinned by fixtures. Nothing reads the clock or
`Math.random()` where a result must be reproducible. Floating-point results are compared
with tolerances in tests, because engines may differ in the last digits.

**Browser safety.** Every package except the visualizer's server runs in browsers. Node-only
code lives behind an explicit subpath (for example `@mindpeeker/entropy/node`), and each
browser-safe package has a browser-safety test that fails on Node built-ins in its browser
entry points (the visualizer checks its client code the same way).

**Honest framing.** State exact mathematics as fact and contested hypotheses as hypotheses.
A statistical result never lends credibility to a metaphysical claim: a small p-value says a
source or design departed from its null, not why. Cite primary sources with links; mark
claims that rest only on web pages as web-sourced; never publish a number you did not compute,
measure or read in a cited source. Use the research-claim review issue template when you think
a document gets this wrong.

**Tests.** Use `bun:test`. Await every `expect(...).rejects` and `expect(...).resolves` (a
Biome GritQL rule, `scripts/biome/unawaited-expect.grit`, makes a missing `await` an error).
When code makes a statistical promise, test it: a null calibration (the false-positive rate
under H0 stays inside a binomial band) is worth more than a single example.

## Reference fixtures

Numbers that tests compare against come from independent references, never from a port of the
TypeScript under test. Each package keeps its generators in `scripts/fixtures/` and checks the
output into `test/fixtures/`, so `bun test` never needs Python.

Most generators are [uv](https://docs.astral.sh/uv/) inline scripts (PEP 723 headers list
their Python version and dependencies):

```sh
uv run packages/judging/scripts/fixtures/generate.py
uv run packages/ephemeris/scripts/fixtures/generate.py
bunx biome format --write packages/judging/test/fixtures   # the checked-in JSON is Biome-formatted
```

Package READMEs list their generators and any special requirements. Known ones:

- `negentropy`: `sequential.py` needs `uv run --python 3.12`.
- `flow`: PyInform ships x86_64 wheels only; on Apple Silicon run the generator under an x86_64
  interpreter (see the flow README).
- `ephemeris`: needs network access for astropy data; if `de440s.bsp` cannot be downloaded, set
  `EPHEMERIS_BSP` to a local kernel path. The kernel is never checked in.
- `ledger`: `notes.py --fetch` replaces the live `sum.golang.org` checkpoint and asks for the
  capture date.

Record the generator and library versions inside the fixture (most fixtures carry a
`generator` field), and add third-party test vectors to
[`docs/data-licenses.md`](docs/data-licenses.md) with their licence.

## Documentation checks

**README import checker.** `bun run check:readme` (part of `bun run check`) reads every fenced
`ts`/`js` block in `README.md`, `docs/**/*.md` and each package README and checks that every
`import … from '@mindpeeker/…'` names something the real entry point exports. A deliberately
hypothetical snippet opts out with the info string `ts no-check`:

````md
```ts no-check
import { futureFeature } from '@mindpeeker/psi'
```
````

**Root README table.** The package table and the mermaid graph in `README.md` are generated
from each `package.json` and the package sources by `bun run readme:table`. `bun run check`
runs it with `--check` and fails when the README is stale, and a test in
`scripts/readme-table.test.ts` does the same. Edit the one-sentence summaries in
`scripts/readme-table.ts`; numbers in them are computed in `scripts/readme-counts.ts`.

**Math.** GitHub renders `$…$` and `$$…$$`. Do not use `\operatorname` or `\#`; they do not
render there.

## Changesets

Releases use [changesets](https://github.com/changesets/changesets). Every pull request that
changes a published package adds a changeset:

```sh
bunx changeset
```

The prompt asks which packages changed, the bump type for each and a summary; it writes a
Markdown file to `.changeset/`. Commit that file with your change. The summary becomes the
package's CHANGELOG entry, so write it for users: what changed and what they must do.

Choosing the bump while packages are at 0.x (see
[decision 0008](docs/decisions/0008-semver-policy-0x.md)):

- **minor** for any change a user can observe in results or contracts: corrected math that
  changes outputs, new or widened error codes, renamed options, new validation that rejects
  inputs accepted before. Also add the change to the "Behaviour changes in …" section of the
  package README.
- **patch** for additions and fixes that change no documented result or signature, and for
  documentation.

Maintainers version and publish as described in [`docs/releasing.md`](docs/releasing.md).

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/) with the package as scope,
and `!` for behaviour changes:

```text
fix(vdf)!: canonical QR_N+ elements close the n - y forgery
feat(oracle): Ifa, cowries, lots, Mo, astragaloi
docs(rate): mark web-sourced history claims
chore(repo): CI gate, dependency-ordered build
```

Keep the subject short and explain the why in the body. One package or topic per commit.
Do not add a `Co-Authored-By` trailer for tools or AI assistants unless attribution is
configured for this repository (`attribution.commit` in `.claude/settings.json`).

Before opening a pull request, run `bun run build && bun run check && bun test`.
