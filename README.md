# mindpeeker-sdk

Bun + TypeScript workspace for mindpeeker's publishable packages.

## Packages

| Package | Description |
|---|---|
| [`@mindpeeker/entropy`](packages/entropy) | Provider-pluggable QRNG/TRNG entropy library for web and Node.js |
| [`@mindpeeker/negentropy`](packages/negentropy) | Order detection (GCP-style statistics, negentropy estimators) and randomness extraction over entropy streams |

## Development

```sh
bun install       # install workspace dependencies
bun test          # run all tests
bun run build     # build all packages (tsc)
bun run check     # biome lint/format check + typecheck
```
