# Releasing

This is the maintainer checklist for publishing the `@mindpeeker/*` packages, written for
v0.2.0 (the first release in which all fifteen packages ship together). Publishing, pushing
and tagging are manual steps that only the maintainer runs.

Versioning follows [decision 0008](decisions/0008-semver-policy-0x.md): while the packages
are 0.x, behaviour changes ship in a minor release and every one is listed.

## 1. Before versioning

- [ ] `main` is clean and CI is green on the commit you will release: build, `bun run check`
      (Biome, typecheck, README import checker, README table check), `bun test`, and
      `publint` plus `arethetypeswrong` for every package.
- [ ] Locally, from a clean state: `bun install --frozen-lockfile && bun run build && bun run check && bun test`.
- [ ] Every change since the last release has a changeset in `.changeset/` (see
      [CONTRIBUTING](../CONTRIBUTING.md#changesets)).
- [ ] Every package README with behaviour changes has an up-to-date
      "Behaviour changes in 0.2.0" section; the changesets should say the same thing.
- [ ] `bun run readme:table` leaves `README.md` unchanged.

## 2. Version

```sh
bunx changeset version                  # applies the changesets: bumps versions, writes CHANGELOG.md files
bun run release:sync-lock               # copies the new versions into bun.lock (see the note below)
bun install --frozen-lockfile           # confirms the lockfile is consistent
grep -c '"version": "0.1.0"' bun.lock   # must print 0 for this release
git diff --stat                         # package.json versions, CHANGELOG.md files, bun.lock
```

> **Bun 1.3.1 gotcha.** `bun install` (also with `--lockfile-only` or `--force`) does not update
> the workspace versions recorded in `bun.lock`, and `bun pm pack` / `bun publish` rewrite
> `workspace:*` from `bun.lock`, not from `package.json`. Without the sync step the 0.2.0 flow
> tarball depended on `@mindpeeker/negentropy` 0.1.0. `scripts/sync-lock-versions.ts` fixes the
> recorded versions; the dry run below must show every `@mindpeeker/*` dependency at the
> release version.

- [ ] Every published package is at `0.2.0`. The four new packages (`ledger`, `coincidence`,
      `ephemeris`, `judging`) were created at `0.2.0`; a bump changeset for them would move
      them past it.
- [ ] Read each generated `CHANGELOG.md`: breaking entries are marked and point users to what
      they must change.
- [ ] `bun run build && bun run check && bun test` pass again, then commit the version change.

## 3. Dry run

For each package, pack a tarball and inspect what would be published:

```sh
cd packages/psi
bun pm pack --destination /tmp/mindpeeker-pack
tar -tzf /tmp/mindpeeker-pack/mindpeeker-psi-0.2.0.tgz | head        # dist/, src/, README.md, LICENSE, package.json
tar -xOzf /tmp/mindpeeker-pack/mindpeeker-psi-0.2.0.tgz package/package.json | grep -A3 '"dependencies"'
```

- [ ] `files` contains `dist` and `src` only (plus the files npm always includes); no test
      fixtures, scripts or `.env`.
- [ ] `workspace:*` dependencies are replaced by real versions (`"@mindpeeker/negentropy": "0.2.0"`).
      Bun does this when packing and publishing: the 0.1.0 tarballs carried resolved versions,
      and `bun pm pack` in `packages/flow` resolved `negentropy` on 2026-09-17.
- [ ] `bun publish --dry-run` succeeds in the package directory.

## 4. Publish

**Gotcha: `bun publish` loads `.env` only from the current directory.** The npm token lives in
the git-ignored `.env` at the workspace root, so run publish from each package directory with
an explicit env file:

```sh
cd packages/<name>
bun --env-file=../../.env publish
```

For 0.1.0 the registry token was supplied through a temporary root `.npmrc` containing
`//registry.npmjs.org/:_authToken=${NPM_ACCESS_TOKEN}`, deleted after publishing (`.npmrc` is
git-ignored). Every package has `publishConfig.access: "public"`, which a first publish of a
scoped package needs.

Publish in dependency order, so that no package reaches the registry before a workspace
dependency it names:

| # | Package | Workspace dependencies | First publish |
|---|---|---|---|
| 1 | `negentropy` | — | |
| 2 | `entropy` | — | |
| 3 | `rate` | — | |
| 4 | `oracle` | — | |
| 5 | `vdf` | — | |
| 6 | `coincidence` | — | yes |
| 7 | `ephemeris` | — | yes |
| 8 | `ledger` | — | yes |
| 9 | `flow` | `negentropy` | |
| 10 | `judging` | `negentropy` | yes |
| 11 | `gematria` | `oracle` | yes |
| 12 | `psi` | `negentropy` | |
| 13 | `field` | `negentropy`, `oracle` | yes |
| 14 | `scan` | `negentropy`, `oracle`, `psi`, `rate` | yes |
| 15 | `visualizer` | `entropy`, `negentropy`, `psi` | |

This order was checked against every `package.json` on 2026-09-17 (flow, judging and the
visualizer's psi dependency are new since 0.1.0). Re-check it when a dependency changes:

```sh
bun -e '
const order = ["negentropy", "entropy", "rate", "oracle", "vdf", "coincidence", "ephemeris", "ledger",
  "flow", "judging", "gematria", "psi", "field", "scan", "visualizer"]
const dirs = [...new Bun.Glob("packages/*/package.json").scanSync()].map((p) => p.split("/")[1])
if (dirs.sort().join() !== [...order].sort().join()) throw new Error(`order must list: ${dirs}`)
for (const [i, dir] of order.entries()) {
  const pkg = await Bun.file(`packages/${dir}/package.json`).json()
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })) {
    const at = order.indexOf(dep.replace("@mindpeeker/", ""))
    if (at > i) throw new Error(`${dir} is published before its dependency ${dep}`)
  }
}
console.log("publish order respects every workspace dependency")
'
```

- [ ] After each publish, `npm view @mindpeeker/<name> version` shows `0.2.0`.
- [ ] After the last one, install the packages into an empty directory outside the workspace
      and import each entry point once (for example `bun add @mindpeeker/scan@0.2.0` and
      `bun -e "import('@mindpeeker/scan').then((m) => console.log(Object.keys(m).length))"`),
      and run `bunx @mindpeeker/visualizer@0.2.0 --list-sources`.

If a publish fails halfway, fix the cause and continue with the same package; published
versions cannot be overwritten, so never re-run the whole list.

## 5. Tag and release notes

```sh
git tag -a v0.2.0 -m "v0.2.0"
git push origin main v0.2.0
gh release create v0.2.0 --title "v0.2.0" --notes-file <notes.md>
```

- [ ] Build the release notes from the generated `CHANGELOG.md` entries: lead with the
      security fix (the 0.1.0 `vdf` verifier accepted `n − y`), then the breaking changes per
      package, then the four new packages and the new features.
- [ ] Record the release in a root `RELEASES.md` (version, date, packages, link to the GitHub
      release).
- [ ] Redeploy the demo site if its pages changed (`.github/workflows/pages.yml`).

## Future work: publishing from CI with provenance

Releases so far were published locally with `bun publish`, without provenance attestations.
npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers) would let a GitHub
Actions workflow (for example `.github/workflows/release.yml`) publish without a stored token:

- configure a trusted publisher for each package on npmjs.com (GitHub organization or user,
  repository, workflow filename);
- give the publish job `permissions: id-token: write`;
- publish with the npm CLI (trusted publishing requires npm CLI 11.5.1 or later and Node
  22.14.0 or later), in the same dependency order as above.

npm then generates provenance attestations automatically for public packages published from a
public repository. Open questions before adopting it: the workflow would publish with `npm`
rather than `bun publish`, so the `workspace:*` replacement must be checked in the packed
tarballs (for example by running `changeset version` and packing with `bun pm pack` first),
and each package needs its trusted-publisher entry before its first CI publish.
